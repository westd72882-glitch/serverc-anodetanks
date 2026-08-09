import { Router } from "express";
import { requireAuth, AuthedRequest } from "../auth";
import { withTransaction, lockProfileRow } from "../db/withTransaction";
import { getProfile, updateEconomy, addOwnedTank, removeOwnedTank, setSelectedTank, clearSelectedTankIfMatches, setTankUpgrades, addFavoriteTank, removeFavoriteTank } from "../db/profileRepo";
import { findTank, STARTER_TANK_ID } from "../data/tankCatalog";
import { sellPriceForTank } from "../data/sellPrice";
import { MAX_UPGRADE_LEVEL, upgradeCost, levelFromPairs, withLevel } from "../data/tankUpgrades";

const router = Router();

router.post("/buy", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const { tankId } = req.body ?? {};
  if (typeof tankId !== "string") {
    res.status(400).json({ error: "tankId is required.", code: "invalid_input" });
    return;
  }

  const entry = findTank(tankId);
  if (!entry || entry.rewardOnly) {
    res.status(404).json({ error: "That tank isn't sold in the Store.", code: "not_purchasable" });
    return;
  }

  try {
    const profile = await withTransaction(async (client) => {
      // FOR UPDATE locks this row until the transaction commits, so a
      // second concurrent buy request from the same account has to wait
      // and then sees the already-updated balance/owned list -- see
      // db/withTransaction.ts for the full reasoning.
      const row = await lockProfileRow(client, accountId);
      const ownedTankIds: string[] = row.owned_tank_ids ?? [];

      if (tankId === STARTER_TANK_ID || ownedTankIds.includes(tankId)) {
        throw Object.assign(new Error("Already owned."), { code: "already_owned", status: 409 });
      }

      if (entry.isGoldTank) {
        const gold = Number(row.gold);
        if (gold < entry.priceGold) {
          throw Object.assign(new Error("Not enough gold."), { code: "insufficient_gold", status: 402 });
        }
        await updateEconomy(client, accountId, { gold: -entry.priceGold });
      } else {
        const credits = Number(row.credits);
        if (credits < entry.price) {
          throw Object.assign(new Error("Not enough credits."), { code: "insufficient_credits", status: 402 });
        }
        await updateEconomy(client, accountId, { credits: -entry.price });
      }

      await addOwnedTank(client, accountId, tankId);
      return await getProfile(accountId, client);
    });

    res.json({ profile });
  } catch (err: any) {
    if (err.code && err.status) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    console.error("tank/buy failed:", err);
    res.status(500).json({ error: "Purchase failed, please try again.", code: "internal_error" });
  }
});

router.post("/sell", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const { tankId } = req.body ?? {};
  if (typeof tankId !== "string") {
    res.status(400).json({ error: "tankId is required.", code: "invalid_input" });
    return;
  }

  const entry = findTank(tankId);
  if (!entry || entry.rewardOnly) {
    res.status(404).json({ error: "That tank can't be sold.", code: "not_sellable" });
    return;
  }

  try {
    const profile = await withTransaction(async (client) => {
      const row = await lockProfileRow(client, accountId);
      const ownedTankIds: string[] = row.owned_tank_ids ?? [];

      // Must be a REAL purchase in owned_tank_ids -- the free starter
      // tank is always "owned" implicitly and never stored there, so it
      // can never be sold (nothing was ever paid for it, and the player
      // needs at least one tank to keep playing).
      if (!ownedTankIds.includes(tankId)) {
        throw Object.assign(new Error("You don't own that tank."), { code: "not_owned", status: 409 });
      }

      const sellPrice = sellPriceForTank(tankId);
      await removeOwnedTank(client, accountId, tankId);
      await updateEconomy(client, accountId, { credits: sellPrice });
      // If the sold tank was equipped, fall back to "" (starter tank)
      // rather than leaving selected_tank_id pointing at something no
      // longer owned.
      await clearSelectedTankIfMatches(client, accountId, tankId);

      return await getProfile(accountId, client);
    });

    res.json({ profile });
  } catch (err: any) {
    if (err.code && err.status) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    console.error("tank/sell failed:", err);
    res.status(500).json({ error: "Sale failed, please try again.", code: "internal_error" });
  }
});

router.post("/select", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const { tankId } = req.body ?? {};
  if (typeof tankId !== "string") {
    res.status(400).json({ error: "tankId is required.", code: "invalid_input" });
    return;
  }

  try {
    const profile = await withTransaction(async (client) => {
      const row = await lockProfileRow(client, accountId);
      const ownedTankIds: string[] = row.owned_tank_ids ?? [];

      // "" (explicitly re-selecting the starter tank) is always allowed;
      // anything else must actually be owned.
      if (tankId !== "" && tankId !== STARTER_TANK_ID && !ownedTankIds.includes(tankId)) {
        throw Object.assign(new Error("You don't own that tank."), { code: "not_owned", status: 409 });
      }

      await setSelectedTank(client, accountId, tankId === STARTER_TANK_ID ? "" : tankId);
      return await getProfile(accountId, client);
    });

    res.json({ profile });
  } catch (err: any) {
    if (err.code && err.status) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    console.error("tank/select failed:", err);
    res.status(500).json({ error: "Selection failed, please try again.", code: "internal_error" });
  }
});

// ============================================================================
// POST /tank/upgrade { tankId, downgrade? } -- moves a tank's upgrade
// level by exactly one step for an account-owned tank.
//
//   downgrade omitted/false: buys the NEXT level, charging credits (see
//     data/tankUpgrades.ts for the cost formula and per-level stat steps
//     the client applies).
//   downgrade: true: rolls the level back by one WITHOUT refunding any
//     credits -- an undo for the level, not a sell-back, per product
//     request. Free to call repeatedly down to the level-1 floor.
//
// The level itself is never taken from the request in either direction:
// only tankId is, and the server reads the current level and moves it by
// exactly one step. Trusting a client-supplied level would let a
// modified client jump straight to 10 for the price of level 2, or
// forge a downgrade into an upgrade.
// ============================================================================
router.post("/upgrade", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const { tankId, downgrade } = req.body ?? {};
  if (typeof tankId !== "string") {
    res.status(400).json({ error: "tankId is required.", code: "invalid_input" });
    return;
  }
  const isDowngrade = downgrade === true;

  const entry = findTank(tankId);
  if (!entry) {
    res.status(404).json({ error: "Unknown tank.", code: "unknown_tank" });
    return;
  }

  try {
    const profile = await withTransaction(async (client) => {
      const row = await lockProfileRow(client, accountId);
      const ownedTankIds: string[] = row.owned_tank_ids ?? [];

      // The free starter tank is always owned implicitly and never stored
      // in owned_tank_ids, so it's checked separately -- it can still be
      // upgraded/downgraded like anything else.
      if (tankId !== STARTER_TANK_ID && !ownedTankIds.includes(tankId)) {
        throw Object.assign(new Error("You don't own that tank."), { code: "not_owned", status: 409 });
      }

      const pairs: string[] = row.tank_upgrades ?? [];
      const level = levelFromPairs(pairs, tankId);

      if (isDowngrade) {
        if (level <= 1) {
          throw Object.assign(new Error("Already at stock level."), { code: "already_min_level", status: 409 });
        }
        // No credits touched here -- see the doc comment above.
        await setTankUpgrades(client, accountId, withLevel(pairs, tankId, level - 1));
        return await getProfile(accountId, client);
      }

      if (level >= MAX_UPGRADE_LEVEL) {
        throw Object.assign(new Error("Already fully upgraded."), { code: "already_max_level", status: 409 });
      }

      const cost = upgradeCost(entry.tier, level);
      const credits = Number(row.credits);
      if (credits < cost) {
        throw Object.assign(new Error("Not enough credits."), { code: "insufficient_credits", status: 402 });
      }

      await updateEconomy(client, accountId, { credits: -cost });
      await setTankUpgrades(client, accountId, withLevel(pairs, tankId, level + 1));

      return await getProfile(accountId, client);
    });

    res.json({ profile });
  } catch (err: any) {
    if (err.code && err.status) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    console.error("tank/upgrade failed:", err);
    res.status(500).json({ error: "Upgrade failed, please try again.", code: "internal_error" });
  }
});

// ============================================================================
// POST /tank/favorite { tankId, favorite } -- adds or removes a tank from
// the account's favorites list (see db/schema.sql's favorite_tank_ids
// comment). Purely a display preference: no economy, no ownership check
// -- favoriting a tank you don't (yet) own is harmless and not worth
// blocking, since it's just a client-side sort hint.
// ============================================================================
router.post("/favorite", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const { tankId, favorite } = req.body ?? {};
  if (typeof tankId !== "string" || typeof favorite !== "boolean") {
    res.status(400).json({ error: "tankId and favorite are required.", code: "invalid_input" });
    return;
  }

  try {
    const profile = await withTransaction(async (client) => {
      if (favorite) {
        await addFavoriteTank(client, accountId, tankId);
      } else {
        await removeFavoriteTank(client, accountId, tankId);
      }
      return await getProfile(accountId, client);
    });

    res.json({ profile });
  } catch (err: any) {
    console.error("tank/favorite failed:", err);
    res.status(500).json({ error: "Could not update favorites, please try again.", code: "internal_error" });
  }
});

export default router;
