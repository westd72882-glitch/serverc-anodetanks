import { pool } from "./pool";
import { Profile, newProfileDefaults } from "../types";
import { PoolClient } from "pg";

// Every column in `profiles` is snake_case in Postgres but camelCase in
// the Profile type the rest of the server uses -- this file is the only
// place that mapping happens, so nothing else needs to know or care
// about the raw column names.
function rowToProfile(row: any): Profile {
  return {
    accountId: row.account_id,
    username: row.username,
    createdAtUnix: new Date(row.created_at).getTime(),
    lastLoginAtUnix: new Date(row.last_login_at).getTime(),
    credits: Number(row.credits),
    gold: Number(row.gold),
    experience: Number(row.experience),
    ownedTankIds: row.owned_tank_ids ?? [],
    selectedTankId: row.selected_tank_id ?? "",
    battlePassClaimedTiers: row.battle_pass_claimed_tiers ?? [],
    rouletteCost: Number(row.roulette_cost),
    rouletteWonRewardIds: row.roulette_won_reward_ids ?? [],
    ownedSkinIds: row.owned_skin_ids ?? [],
    equippedSkinIds: row.equipped_skin_ids ?? [],
    tankUpgrades: row.tank_upgrades ?? [],
    storedChestIds: row.stored_chest_ids ?? [],
  };
}

// Fetches one profile, joined with its account's username. Returns null
// if the account doesn't exist (shouldn't normally happen once logged
// in, but every caller should still handle it rather than assume).
export async function getProfile(accountId: number, client: PoolClient | typeof pool = pool): Promise<Profile | null> {
  const result = await client.query(
    `SELECT p.*, a.username
     FROM profiles p
     JOIN accounts a ON a.id = p.account_id
     WHERE p.account_id = $1`,
    [accountId]
  );
  if (result.rows.length === 0) return null;
  return rowToProfile(result.rows[0]);
}

// Creates the profiles row for a freshly-registered account, with every
// field at its default (see types.ts newProfileDefaults). Called once,
// right after the accounts row is inserted in routes/auth.ts.
export async function createProfile(accountId: number, client: PoolClient): Promise<void> {
  const d = newProfileDefaults();
  await client.query(
    `INSERT INTO profiles (account_id, credits, gold, experience, owned_tank_ids, selected_tank_id, battle_pass_claimed_tiers, roulette_cost, roulette_won_reward_ids)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [accountId, d.credits, d.gold, d.experience, d.ownedTankIds, d.selectedTankId, d.battlePassClaimedTiers, d.rouletteCost, d.rouletteWonRewardIds]
  );
}

export async function touchLastLogin(accountId: number, client: PoolClient | typeof pool = pool): Promise<void> {
  await client.query(`UPDATE profiles SET last_login_at = now() WHERE account_id = $1`, [accountId]);
}

// --- Mutation helpers used by the economy routes --------------------------
// Every one of these takes a PoolClient from an active transaction (see
// db/withTransaction.ts) -- economy mutations always read-then-write
// inside a single transaction so two concurrent requests from the same
// account (e.g. a double-tapped Buy button) can't both read the same
// stale balance and both succeed when only one should.

export async function updateEconomy(
  client: PoolClient,
  accountId: number,
  delta: { credits?: number; gold?: number; experience?: number }
): Promise<void> {
  await client.query(
    `UPDATE profiles
     SET credits = credits + $2,
         gold = gold + $3,
         experience = experience + $4
     WHERE account_id = $1`,
    [accountId, delta.credits ?? 0, delta.gold ?? 0, delta.experience ?? 0]
  );
}

export async function addOwnedTank(client: PoolClient, accountId: number, tankId: string): Promise<void> {
  await client.query(
    `UPDATE profiles
     SET owned_tank_ids = array_append(owned_tank_ids, $2)
     WHERE account_id = $1 AND NOT ($2 = ANY(owned_tank_ids))`,
    [accountId, tankId]
  );
}

export async function removeOwnedTank(client: PoolClient, accountId: number, tankId: string): Promise<void> {
  await client.query(
    `UPDATE profiles
     SET owned_tank_ids = array_remove(owned_tank_ids, $2)
     WHERE account_id = $1`,
    [accountId, tankId]
  );
}

export async function setSelectedTank(client: PoolClient, accountId: number, tankId: string): Promise<void> {
  await client.query(`UPDATE profiles SET selected_tank_id = $2 WHERE account_id = $1`, [accountId, tankId]);
}

export async function clearSelectedTankIfMatches(client: PoolClient, accountId: number, tankId: string): Promise<void> {
  await client.query(
    `UPDATE profiles SET selected_tank_id = '' WHERE account_id = $1 AND selected_tank_id = $2`,
    [accountId, tankId]
  );
}

export async function addBattlePassClaimedTier(client: PoolClient, accountId: number, tier: number): Promise<void> {
  await client.query(
    `UPDATE profiles
     SET battle_pass_claimed_tiers = array_append(battle_pass_claimed_tiers, $2)
     WHERE account_id = $1 AND NOT ($2 = ANY(battle_pass_claimed_tiers))`,
    [accountId, tier]
  );
}

export async function setRouletteCost(client: PoolClient, accountId: number, cost: number): Promise<void> {
  await client.query(`UPDATE profiles SET roulette_cost = $2 WHERE account_id = $1`, [accountId, cost]);
}

// --- Skins -----------------------------------------------------------------

export async function addOwnedSkin(client: PoolClient, accountId: number, skinId: string): Promise<void> {
  await client.query(
    `UPDATE profiles
     SET owned_skin_ids = array_append(owned_skin_ids, $2)
     WHERE account_id = $1 AND NOT ($2 = ANY(owned_skin_ids))`,
    [accountId, skinId]
  );
}

// Replaces the whole equipped list in one write. The caller works out the
// new list (see routes/skin.ts), because the one-skin-per-tank rule needs
// the catalog to decide which existing entries belong to the same tank --
// that's application logic, not something to express in SQL here.
export async function setEquippedSkins(client: PoolClient, accountId: number, skinIds: string[]): Promise<void> {
  await client.query(`UPDATE profiles SET equipped_skin_ids = $2 WHERE account_id = $1`, [accountId, skinIds]);
}

// --- Per-tank upgrades ------------------------------------------------------

export async function setTankUpgrades(client: PoolClient, accountId: number, pairs: string[]): Promise<void> {
  await client.query(`UPDATE profiles SET tank_upgrades = $2 WHERE account_id = $1`, [accountId, pairs]);
}

// --- Storage (unopened chests) ----------------------------------------------

export async function addStoredChest(client: PoolClient, accountId: number, storedId: string): Promise<void> {
  await client.query(
    `UPDATE profiles SET stored_chest_ids = array_append(stored_chest_ids, $2) WHERE account_id = $1`,
    [accountId, storedId]
  );
}

// Removes exactly one occurrence of `storedId`. Uses array_remove, which
// (unlike a client-side filter-and-rewrite) is atomic against concurrent
// writes to other elements of the same array -- important here since a
// player could plausibly buy a second chest while the first is mid-open.
export async function removeStoredChest(client: PoolClient, accountId: number, storedId: string): Promise<void> {
  await client.query(
    `UPDATE profiles SET stored_chest_ids = array_remove(stored_chest_ids, $2) WHERE account_id = $1`,
    [accountId, storedId]
  );
}

export async function addRouletteWonReward(client: PoolClient, accountId: number, rewardId: string): Promise<void> {
  await client.query(
    `UPDATE profiles
     SET roulette_won_reward_ids = array_append(roulette_won_reward_ids, $2)
     WHERE account_id = $1 AND NOT ($2 = ANY(roulette_won_reward_ids))`,
    [accountId, rewardId]
  );
}
