import { Router } from "express";
import { requireAuth, AuthedRequest } from "../auth";
import { withTransaction, lockProfileRow } from "../db/withTransaction";
import { getProfile, updateEconomy } from "../db/profileRepo";

const router = Router();

// Mirrors ProfileManager::RecordBattleResult's payout formula in the C++
// client exactly -- see gamescripts/ProfileManager.cpp. The server
// recomputes the credits itself from the reported battle outcome rather
// than accepting a credits number from the client, so a modified client
// can't just claim "I earned 9999999".
//
// HONEST LIMITATION: the battle itself is simulated entirely on the
// client (it's a vs-bots game with no server-side match authority), so
// the kills/damage numbers this endpoint receives are still
// client-reported and therefore inherently trustable only as far as the
// client is. Verifying those properly would require running the whole
// match server-side, which is a much larger project. The caps below at
// least bound how absurd a forged claim can be, so a trivially-modified
// client can't mint unlimited currency in one request.
const MAX_KILLS_PER_BATTLE = 30;
const MAX_DAMAGE_PER_BATTLE = 20000;
const MAX_XP_PER_BATTLE = 20000;

function computeCreditsReward(won: boolean, kills: number, damageDealt: number): number {
  let credits = 200; // base payout just for finishing a battle
  if (won) credits += 300;
  credits += kills * 150;
  credits += Math.floor(damageDealt * 2.0);
  return credits;
}

router.post("/result", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const { won, kills, damageDealt, xpGained } = req.body ?? {};

  if (typeof won !== "boolean") {
    res.status(400).json({ error: "won (boolean) is required.", code: "invalid_input" });
    return;
  }

  // Clamp everything into sane ranges before it touches the payout math.
  const safeKills = Math.max(0, Math.min(MAX_KILLS_PER_BATTLE, Number(kills) || 0));
  const safeDamage = Math.max(0, Math.min(MAX_DAMAGE_PER_BATTLE, Number(damageDealt) || 0));
  const safeXp = Math.max(0, Math.min(MAX_XP_PER_BATTLE, Number(xpGained) || 0));

  try {
    const { profile, creditsGained } = await withTransaction(async (client) => {
      await lockProfileRow(client, accountId);
      const creditsGained = computeCreditsReward(won, safeKills, safeDamage);
      await updateEconomy(client, accountId, { credits: creditsGained, experience: safeXp });
      const profile = await getProfile(accountId, client);
      return { profile, creditsGained };
    });

    res.json({ profile, creditsGained });
  } catch (err) {
    console.error("battle/result failed:", err);
    res.status(500).json({ error: "Could not record battle result.", code: "internal_error" });
  }
});

export default router;
