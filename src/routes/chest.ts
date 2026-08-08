import { Router } from "express";
import { requireAuth, AuthedRequest } from "../auth";
import { withTransaction, lockProfileRow } from "../db/withTransaction";
import { getProfile, updateEconomy, addOwnedTank } from "../db/profileRepo";
import { findChest } from "../data/chestCatalog";
import { TANK_CATALOG, STARTER_TANK_ID } from "../data/tankCatalog";

const router = Router();

router.post("/open", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const { chestId } = req.body ?? {};
  if (typeof chestId !== "string") {
    res.status(400).json({ error: "chestId is required.", code: "invalid_input" });
    return;
  }

  const chest = findChest(chestId);
  if (!chest) {
    res.status(404).json({ error: "No such chest.", code: "not_found" });
    return;
  }

  try {
    const { profile, result } = await withTransaction(async (client) => {
      const row = await lockProfileRow(client, accountId);
      const credits = Number(row.credits);
      // Chests are priced in either currency (ChestDef.costsGold).
      if (chest.costsGold) {
        const gold = Number(row.gold);
        if (gold < chest.price) {
          throw Object.assign(new Error("Not enough gold."), { code: "insufficient_gold", status: 402 });
        }
        await updateEconomy(client, accountId, { gold: -chest.price });
      } else {
        if (credits < chest.price) {
          throw Object.assign(new Error("Not enough credits."), { code: "insufficient_credits", status: 402 });
        }
        await updateEconomy(client, accountId, { credits: -chest.price });
      }

      const ownedTankIds: string[] = row.owned_tank_ids ?? [];
      const notOwnedPremiums = TANK_CATALOG.filter(
        (t) => t.isGoldTank && !t.rewardOnly && t.id !== STARTER_TANK_ID && !ownedTankIds.includes(t.id)
      );

      let result: { kind: "tank"; tankId: string } | { kind: "credits" | "experience"; amount: number };

      if (notOwnedPremiums.length > 0 && Math.random() < chest.tankDropChance) {
        const won = notOwnedPremiums[Math.floor(Math.random() * notOwnedPremiums.length)];
        await addOwnedTank(client, accountId, won.id);
        result = { kind: "tank", tankId: won.id };
      } else if (Math.random() < 0.5) {
        const amount = chest.creditsMin + Math.floor(Math.random() * (chest.creditsMax - chest.creditsMin + 1));
        await updateEconomy(client, accountId, { credits: amount });
        result = { kind: "credits", amount };
      } else {
        const amount = chest.xpMin + Math.floor(Math.random() * (chest.xpMax - chest.xpMin + 1));
        await updateEconomy(client, accountId, { experience: amount });
        result = { kind: "experience", amount };
      }

      const profile = await getProfile(accountId, client);
      return { profile, result };
    });

    res.json({ profile, result });
  } catch (err: any) {
    if (err.code && err.status) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    console.error("chest/open failed:", err);
    res.status(500).json({ error: "Opening the chest failed, please try again.", code: "internal_error" });
  }
});

export default router;
