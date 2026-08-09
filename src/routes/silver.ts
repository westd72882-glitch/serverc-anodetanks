import { Router } from "express";
import { requireAuth, AuthedRequest } from "../auth";
import { withTransaction, lockProfileRow } from "../db/withTransaction";
import { getProfile, updateEconomy } from "../db/profileRepo";
import { findSilverPack } from "../data/silverCatalog";

// ============================================================================
// POST /silver/buy { credits } -- exchanges gold for credits in one
// transaction. Unlike /gold's real-money packs (which only grant
// anything after an external payment confirms), this is a pure in-game
// exchange: gold is deducted and credits are granted in the SAME
// request, so it either fully succeeds or changes nothing at all.
//
// `credits` identifies which catalog pack was tapped (see
// data/silverCatalog.ts) -- the actual gold price is always looked up
// server-side from that catalog, never taken from the client, so a
// modified client can't request a discount.
// ============================================================================

const router = Router();

router.post("/buy", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const { credits } = req.body ?? {};
  if (typeof credits !== "number" || !Number.isFinite(credits)) {
    res.status(400).json({ error: "credits is required.", code: "invalid_input" });
    return;
  }

  const pack = findSilverPack(credits);
  if (!pack) {
    res.status(404).json({ error: "That silver pack isn't sold in the Store.", code: "not_purchasable" });
    return;
  }

  try {
    const profile = await withTransaction(async (client) => {
      // Same row lock as every other purchase route -- without it two
      // rapid taps could both read the same gold balance and both pass
      // the affordability check.
      const row = await lockProfileRow(client, accountId);
      const gold = Number(row.gold);
      if (gold < pack.priceGold) {
        throw Object.assign(new Error("Not enough gold."), { code: "insufficient_gold", status: 402 });
      }

      await updateEconomy(client, accountId, { gold: -pack.priceGold, credits: pack.credits });
      return await getProfile(accountId, client);
    });

    res.json({ profile });
  } catch (err: any) {
    if (err.code && err.status) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    console.error("silver/buy failed:", err);
    res.status(500).json({ error: "Purchase failed, please try again.", code: "internal_error" });
  }
});

export default router;
