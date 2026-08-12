import { Router } from "express";
import { requireAuth, AuthedRequest } from "../auth";
import { withTransaction, lockProfileRow } from "../db/withTransaction";
import { getProfile, updateEconomy, setMissionClears } from "../db/profileRepo";
import { findMission, clearsFromPairs, withClears, missionReward } from "../data/missionCatalog";

// ============================================================================
// POST /mission/complete { missionId } -- records a special-mission clear
// and pays out. The AMOUNT is never taken from the request: the server
// reads its own stored clear count, derives the (halved) payout from it,
// and only then increments. A client that replays this endpoint just
// keeps halving its own reward, which is exactly the intended behaviour.
//
// There is deliberately no server-side verification that the battle was
// actually won -- battles are simulated entirely client-side in this
// game (same as the existing /battle result endpoint), so this endpoint
// is exactly as trusting as that one already is. Worth revisiting
// together with battle validation if cheating becomes a real problem.
// ============================================================================

const router = Router();

router.post("/complete", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const { missionId } = req.body ?? {};
  if (typeof missionId !== "string") {
    res.status(400).json({ error: "missionId is required.", code: "invalid_input" });
    return;
  }

  const def = findMission(missionId);
  if (!def) {
    res.status(404).json({ error: "Unknown mission.", code: "unknown_mission" });
    return;
  }

  try {
    const profile = await withTransaction(async (client) => {
      const row = await lockProfileRow(client, accountId);
      const pairs: string[] = row.mission_clears ?? [];
      const clears = clearsFromPairs(pairs, missionId);

      const reward = missionReward(def, clears);
      await updateEconomy(client, accountId, { credits: reward });
      await setMissionClears(client, accountId, withClears(pairs, missionId, clears + 1));

      return await getProfile(accountId, client);
    });

    res.json({ profile });
  } catch (err: any) {
    console.error("mission/complete failed:", err);
    res.status(500).json({ error: "Could not record the mission, please try again.", code: "internal_error" });
  }
});

export default router;
