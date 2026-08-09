import { Router } from "express";
import { requireAuth, AuthedRequest } from "../auth";
import { withTransaction, lockProfileRow } from "../db/withTransaction";
import { getProfile, updateEconomy } from "../db/profileRepo";
import { findPromoCode } from "../promo";

const router = Router();

router.post("/redeem", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const rawCode = (req.body ?? {}).code;
  if (typeof rawCode !== "string" || !rawCode.trim()) {
    res.status(400).json({ error: "Enter a promo code.", code: "invalid_input" });
    return;
  }
  const codeName = rawCode.trim().toLowerCase();

  const promo = findPromoCode(codeName);
  if (!promo) {
    // Same message whether the code never existed or was mistyped -- no
    // reason to help someone probe for valid codes.
    res.status(404).json({ error: "Invalid promo code.", code: "invalid_code" });
    return;
  }

  try {
    const result = await withTransaction(async (client) => {
      // Lock the profile first, then the counter row, always in that
      // order -- two requests taking the same locks in the same order
      // can't deadlock against each other.
      const row = await lockProfileRow(client, accountId);
      const alreadyUsed: string[] = row.redeemed_promo_codes ?? [];
      if (alreadyUsed.includes(promo.name)) {
        throw Object.assign(new Error("You have already used this code."), {
          code: "already_redeemed",
          status: 409,
        });
      }

      // Claim one activation atomically. The WHERE clause is what makes
      // this safe under concurrency: if two players redeem the last
      // activation at the same moment, only one UPDATE matches a row
      // still under the limit, and the other gets zero rows back.
      await client.query(
        `INSERT INTO promo_activations (code, used_count) VALUES ($1, 0)
         ON CONFLICT (code) DO NOTHING`,
        [promo.name]
      );
      const claim = await client.query(
        `UPDATE promo_activations
         SET used_count = used_count + 1
         WHERE code = $1 AND used_count < $2
         RETURNING used_count`,
        [promo.name, promo.maxActivations]
      );
      if (claim.rowCount === 0) {
        throw Object.assign(new Error("This code has already been fully used."), {
          code: "code_exhausted",
          status: 409,
        });
      }

      await client.query(
        `UPDATE profiles
         SET redeemed_promo_codes = array_append(redeemed_promo_codes, $2)
         WHERE account_id = $1`,
        [accountId, promo.name]
      );

      await updateEconomy(client, accountId, {
        credits: promo.currency === "credits" ? promo.amount : 0,
        gold: promo.currency === "gold" ? promo.amount : 0,
      });

      const profile = await getProfile(accountId, client);
      return { profile, amount: promo.amount, currency: promo.currency };
    });

    res.json(result);
  } catch (err: any) {
    if (err.code && err.status) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    console.error("promo/redeem failed:", err);
    res.status(500).json({ error: "Could not redeem the code.", code: "internal_error" });
  }
});

export default router;
