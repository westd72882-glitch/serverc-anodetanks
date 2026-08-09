import { randomUUID } from "crypto";
import { Router } from "express";
import { requireAuth, AuthedRequest } from "../auth";
import { withTransaction, lockProfileRow } from "../db/withTransaction";
import { getProfile, updateEconomy, addOwnedTank, addStoredChest, removeStoredChest } from "../db/profileRepo";
import { findChest } from "../data/chestCatalog";
import { TANK_CATALOG, STARTER_TANK_ID } from "../data/tankCatalog";

const router = Router();

// ============================================================================
// POST /chest/buy { chestId } -- pays for a chest and puts it in Storage,
// UNOPENED. This used to be a single "buy and immediately open" call
// (the old /chest/open below); it's split in two now so a purchase and
// the reward reveal are separate moments -- the reward is only rolled
// when the player actually opens the chest from the Storage tab.
// ============================================================================
router.post("/buy", requireAuth, async (req, res) => {
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
    const profile = await withTransaction(async (client) => {
      const row = await lockProfileRow(client, accountId);

      if (chest.costsGold) {
        const gold = Number(row.gold);
        if (gold < chest.price) {
          throw Object.assign(new Error("Not enough gold."), { code: "insufficient_gold", status: 402 });
        }
        await updateEconomy(client, accountId, { gold: -chest.price });
      } else {
        const credits = Number(row.credits);
        if (credits < chest.price) {
          throw Object.assign(new Error("Not enough credits."), { code: "insufficient_credits", status: 402 });
        }
        await updateEconomy(client, accountId, { credits: -chest.price });
      }

      // instanceId only needs to be unique WITHIN this account's storage
      // array (so two chests of the same type both get their own openable
      // key) -- a short random suffix is enough, a full UUID would just
      // make the stored strings needlessly long.
      const instanceId = randomUUID().slice(0, 8);
      await addStoredChest(client, accountId, `${chest.id}:${instanceId}`);

      return await getProfile(accountId, client);
    });

    res.json({ profile });
  } catch (err: any) {
    if (err.code && err.status) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    console.error("chest/buy failed:", err);
    res.status(500).json({ error: "Purchase failed, please try again.", code: "internal_error" });
  }
});

// ============================================================================
// POST /chest/open { storedId } -- opens ONE specific chest instance
// sitting in Storage ("chestId:instanceId", exactly as returned in
// profile.storedChestIds) and rolls its reward.
//
// storedId is required (not just chestId) so opening one particular
// crate never accidentally consumes a different one of the same type --
// with several identical chests in storage, chestId alone couldn't tell
// them apart.
// ============================================================================
router.post("/open", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const { storedId } = req.body ?? {};
  if (typeof storedId !== "string") {
    res.status(400).json({ error: "storedId is required.", code: "invalid_input" });
    return;
  }

  const colon = storedId.indexOf(":");
  const chestId = colon > 0 ? storedId.slice(0, colon) : storedId;
  const chest = findChest(chestId);
  if (!chest) {
    res.status(404).json({ error: "No such chest.", code: "not_found" });
    return;
  }

  try {
    const { profile, result } = await withTransaction(async (client) => {
      const row = await lockProfileRow(client, accountId);
      const stored: string[] = row.stored_chest_ids ?? [];
      if (!stored.includes(storedId)) {
        // Covers both "already opened" (double-tap) and "never owned" --
        // either way there's nothing here to open, so the two cases share
        // one response rather than needing to be told apart.
        throw Object.assign(new Error("That chest isn't in your storage."), { code: "not_in_storage", status: 409 });
      }

      // Removed BEFORE rolling the reward: if the process crashed or the
      // request failed between rolling and responding, we'd rather the
      // player lose an already-rolled prize (rare, and the transaction
      // rollback prevents even that) than end up able to open the same
      // stored chest twice.
      await removeStoredChest(client, accountId, storedId);

      const ownedTankIds: string[] = row.owned_tank_ids ?? [];

      let result: { kind: "tank"; tankId: string } | { kind: "credits" | "experience"; amount: number };

      if (chest.guaranteedTier > 0) {
        // Certificate: always a tank, restricted to exactly this tier,
        // ANY tank at that tier the player doesn't already own (not just
        // premium ones -- unlike a regular chest's drop pool below). No
        // currency fallback except the one edge case: every tier-N tank
        // is already owned, in which case there's nothing left to
        // guarantee and the certificate refunds its own price as credits
        // rather than silently vanishing.
        const tierTanks = TANK_CATALOG.filter(
          (t) => t.tier === chest.guaranteedTier && !t.rewardOnly && !ownedTankIds.includes(t.id)
        );
        if (tierTanks.length > 0) {
          const won = tierTanks[Math.floor(Math.random() * tierTanks.length)];
          await addOwnedTank(client, accountId, won.id);
          result = { kind: "tank", tankId: won.id };
        } else {
          await updateEconomy(client, accountId, { credits: chest.price });
          result = { kind: "credits", amount: chest.price };
        }

        const profile = await getProfile(accountId, client);
        return { profile, result };
      }

      const notOwnedPremiums = TANK_CATALOG.filter(
        (t) => t.isGoldTank && !t.rewardOnly && t.id !== STARTER_TANK_ID && !ownedTankIds.includes(t.id)
      );

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
