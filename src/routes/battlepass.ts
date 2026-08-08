import { Router } from "express";
import { requireAuth, AuthedRequest } from "../auth";
import { withTransaction, lockProfileRow } from "../db/withTransaction";
import { getProfile, updateEconomy, addOwnedTank, addBattlePassClaimedTier } from "../db/profileRepo";
import {
  BP_TIER_COUNT,
  BP_CREDITS_PER_TIER,
  BP_FINAL_TIER,
  BP_BONUS_TANK_TIER,
  BP_FINAL_TANK_ID,
  BP_BONUS_TANK_ID,
  bpTierGrantsGold,
  bpXpRequiredForTier,
  BP_GOLD_PER_MILESTONE,
} from "../data/battlePass";

const router = Router();

router.post("/claim", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const { tier } = req.body ?? {};
  if (typeof tier !== "number" || !Number.isInteger(tier) || tier < 1 || tier > BP_TIER_COUNT) {
    res.status(400).json({ error: "Invalid tier.", code: "invalid_input" });
    return;
  }

  try {
    const profile = await withTransaction(async (client) => {
      const row = await lockProfileRow(client, accountId);
      const experience = Number(row.experience);
      const claimedTiers: number[] = row.battle_pass_claimed_tiers ?? [];

      if (experience < bpXpRequiredForTier(tier)) {
        throw Object.assign(new Error("Tier still locked."), { code: "tier_locked", status: 409 });
      }
      if (claimedTiers.includes(tier)) {
        throw Object.assign(new Error("Already claimed."), { code: "already_claimed", status: 409 });
      }

      await addBattlePassClaimedTier(client, accountId, tier);
      await updateEconomy(client, accountId, {
        credits: BP_CREDITS_PER_TIER,
        gold: bpTierGrantsGold(tier) ? BP_GOLD_PER_MILESTONE : 0,
      });

      if (tier === BP_FINAL_TIER) {
        await addOwnedTank(client, accountId, BP_FINAL_TANK_ID);
      } else if (tier === BP_BONUS_TANK_TIER) {
        await addOwnedTank(client, accountId, BP_BONUS_TANK_ID);
      }

      return await getProfile(accountId, client);
    });

    res.json({ profile });
  } catch (err: any) {
    if (err.code && err.status) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    console.error("battlepass/claim failed:", err);
    res.status(500).json({ error: "Claim failed, please try again.", code: "internal_error" });
  }
});

export default router;
