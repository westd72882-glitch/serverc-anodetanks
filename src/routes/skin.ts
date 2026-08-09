import { Router } from "express";
import { requireAuth, AuthedRequest } from "../auth";
import { withTransaction, lockProfileRow } from "../db/withTransaction";
import { getProfile, updateEconomy, addOwnedSkin, setEquippedSkins } from "../db/profileRepo";
import { findSkin, equippedIdsForTank } from "../data/skinCatalog";

// ============================================================================
// Cosmetic skins (see data/skinCatalog.ts).
//
//   POST /skin/buy   { skinId }            -- spends gold, grants ownership
//   POST /skin/equip { tankId, skinId }    -- skinId "" = back to stock paint
//
// Both return the full profile, same as every other mutating endpoint, so
// the client replaces its local copy wholesale instead of patching fields
// based on what it assumes happened (see types.ts ProfileResponse).
//
// Buying a skin never equips it: the client decides that separately, and
// making the purchase silently change what's on the tank would be a
// surprise the player didn't ask for.
// ============================================================================

const router = Router();

router.post("/buy", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const { skinId } = req.body ?? {};
  if (typeof skinId !== "string") {
    res.status(400).json({ error: "skinId is required.", code: "invalid_input" });
    return;
  }

  const entry = findSkin(skinId);
  if (!entry) {
    res.status(404).json({ error: "That skin isn't sold in the Store.", code: "not_purchasable" });
    return;
  }

  try {
    const profile = await withTransaction(async (client) => {
      // Same row lock as tank purchases: without it two rapid taps could
      // both read the same gold balance, both pass the affordability
      // check, and both deduct -- see db/withTransaction.ts.
      const row = await lockProfileRow(client, accountId);
      const ownedSkinIds: string[] = row.owned_skin_ids ?? [];

      if (ownedSkinIds.includes(skinId)) {
        throw Object.assign(new Error("Already owned."), { code: "already_owned", status: 409 });
      }

      const gold = Number(row.gold);
      if (gold < entry.priceGold) {
        throw Object.assign(new Error("Not enough gold."), { code: "insufficient_gold", status: 402 });
      }

      await updateEconomy(client, accountId, { gold: -entry.priceGold });
      await addOwnedSkin(client, accountId, skinId);
      return await getProfile(accountId, client);
    });

    res.json({ profile });
  } catch (err: any) {
    if (err.code && err.status) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    console.error("skin/buy failed:", err);
    res.status(500).json({ error: "Purchase failed, please try again.", code: "internal_error" });
  }
});

router.post("/equip", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const { tankId, skinId } = req.body ?? {};
  if (typeof tankId !== "string" || typeof skinId !== "string") {
    res.status(400).json({ error: "tankId and skinId are required.", code: "invalid_input" });
    return;
  }

  // An empty skinId means "go back to stock paint on this tank", which is
  // why tankId is sent as well -- with the skin id blank there'd otherwise
  // be no way to know which vehicle to clear.
  const entry = skinId === "" ? null : findSkin(skinId);
  if (skinId !== "" && !entry) {
    res.status(404).json({ error: "Unknown skin.", code: "unknown_skin" });
    return;
  }
  if (entry && entry.tankId !== tankId) {
    res.status(409).json({ error: "That skin doesn't fit this tank.", code: "wrong_tank" });
    return;
  }

  try {
    const profile = await withTransaction(async (client) => {
      const row = await lockProfileRow(client, accountId);
      const ownedSkinIds: string[] = row.owned_skin_ids ?? [];
      const equippedSkinIds: string[] = row.equipped_skin_ids ?? [];

      if (entry && !ownedSkinIds.includes(skinId)) {
        throw Object.assign(new Error("You don't own that skin."), { code: "not_owned", status: 409 });
      }

      // One skin per tank: drop whatever this tank was already wearing,
      // then add the new one (or nothing at all, for stock paint).
      const toRemove = new Set(equippedIdsForTank(equippedSkinIds, tankId));
      const next = equippedSkinIds.filter((id) => !toRemove.has(id));
      if (entry) next.push(skinId);

      await setEquippedSkins(client, accountId, next);
      return await getProfile(accountId, client);
    });

    res.json({ profile });
  } catch (err: any) {
    if (err.code && err.status) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    console.error("skin/equip failed:", err);
    res.status(500).json({ error: "Could not equip that skin.", code: "internal_error" });
  }
});

export default router;
