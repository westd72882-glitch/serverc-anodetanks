-- ============================================================================
-- Schema for the tank game's server-authoritative backend.
--
-- Two tables:
--   accounts -- login credentials only (username + password hash)
--   profiles -- everything else (currency, owned tanks, roulette state,
--               battle pass progress), one row per account, 1:1 via
--               account_id
--
-- Split into two tables (rather than one) so password_hash never has to
-- be touched/selected by any of the economy endpoints -- those only ever
-- query/update `profiles`, which has no sensitive auth data in it at all.
-- ============================================================================

CREATE TABLE IF NOT EXISTS accounts (
    id            SERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Case-insensitive username lookups (so "Player1" and "player1" collide
-- correctly at both registration and login) without needing a citext
-- extension -- a plain lowercase functional index is enough here.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_username_lower_idx
    ON accounts (LOWER(username));

CREATE TABLE IF NOT EXISTS profiles (
    account_id                INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,

    -- Economy
    credits                   BIGINT NOT NULL DEFAULT 0,
    gold                      BIGINT NOT NULL DEFAULT 0,
    experience                BIGINT NOT NULL DEFAULT 0,

    -- Garage. owned_tank_ids does NOT include the free starter tank (see
    -- src/data/tankCatalog.ts STARTER_TANK_ID) -- it's always owned
    -- implicitly and never stored here, same as the C++ client's
    -- ProfileManager::IsTankOwned(string) shortcut.
    owned_tank_ids             TEXT[] NOT NULL DEFAULT '{}',
    selected_tank_id           TEXT NOT NULL DEFAULT '',

    -- Battle Pass: 1-based tier numbers already claimed.
    battle_pass_claimed_tiers  INTEGER[] NOT NULL DEFAULT '{}',

    -- Roulette: 0 = never spun yet (server treats that as
    -- ROULETTE_BASE_COST, see src/data/rouletteCatalog.ts), doubles after
    -- every successful spin. won_reward_ids can never repeat a value.
    roulette_cost              BIGINT NOT NULL DEFAULT 0,
    roulette_won_reward_ids    TEXT[] NOT NULL DEFAULT '{}',

    created_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- Promo codes.
--
-- The codes themselves are NOT stored here -- they're defined in the
-- PROMOCODE environment variable on the host (see src/promo.ts), so they
-- can be changed without a migration. What lives in the database is the
-- part that must survive restarts: how many times each code has been
-- redeemed globally, and which codes each account has already used.
-- Keeping the counter in Postgres rather than in memory is what stops a
-- redeploy from silently resetting a "1 activation" code back to unused.
-- ============================================================================

CREATE TABLE IF NOT EXISTS promo_activations (
    code       TEXT PRIMARY KEY,   -- lowercased code name
    used_count INTEGER NOT NULL DEFAULT 0
);

-- Codes this account has already redeemed, so the same one can't be used
-- twice on one account even while global activations remain.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS redeemed_promo_codes TEXT[] NOT NULL DEFAULT '{}';

-- ============================================================================
-- Cosmetic skins + per-tank upgrade levels.
--
-- Added as ALTER ... IF NOT EXISTS rather than columns in the CREATE TABLE
-- above so an already-deployed database picks them up on the next
-- `npm run migrate` instead of needing the table dropped -- existing
-- accounts just start with the empty defaults, which is exactly the
-- correct state for them (no skins bought, every tank at stock level 1).
--
-- owned_skin_ids  : every skin id (data/skinCatalog.ts) this account bought.
-- equipped_skin_ids: the subset currently worn, at most one per tank.
-- tank_upgrades   : "tankId:level" pairs; only tanks above stock appear.
-- ============================================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS owned_skin_ids    TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS equipped_skin_ids TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS tank_upgrades     TEXT[] NOT NULL DEFAULT '{}';

-- ============================================================================
-- Storage (unopened chests/containers).
--
-- Buying a chest in the Store no longer opens it immediately -- it goes
-- into this array instead, and is only actually opened (rolled for a
-- reward) from the Storage tab. Each entry is "chestId:instanceId",
-- e.g. "chest_premium:7f3a2c1e" -- the instanceId exists purely so two
-- chests of the SAME type sitting in storage together have distinct,
-- individually-openable keys; it carries no other meaning and is
-- generated server-side (crypto.randomUUID(), truncated) whenever a
-- chest is bought.
-- ============================================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS stored_chest_ids  TEXT[] NOT NULL DEFAULT '{}';

-- ============================================================================
-- Favorite tanks.
--
-- Purely a display preference (see gamescripts/ProfileManager.h) -- pins
-- favorited tanks to the front of the garage carousel ahead of whatever
-- sort mode is active. No economy involved, so unlike stored_chest_ids
-- or tank_upgrades there's no accompanying "instanceId" or cost logic,
-- just a plain list of tank ids.
-- ============================================================================
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS favorite_tank_ids TEXT[] NOT NULL DEFAULT '{}';
