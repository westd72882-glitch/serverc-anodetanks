# Tank Game Server

Server-authoritative backend for the tank game. Handles accounts and every
economy action (buying/selling tanks, roulette, chests, Battle Pass) --
the client never computes a price or rolls a random reward itself, it only
asks the server to do it and applies whatever profile comes back.

See **DEPLOY.md** for step-by-step Render deployment instructions.

## Local development

```
cp .env.example .env
# fill in DATABASE_URL (a local Postgres, or a Render one) and JWT_SECRET
npm install
npm run build
npm run migrate   # creates tables, safe to re-run
npm run dev        # starts with auto-reload on file changes
```

## API

All endpoints except `/auth/*` require `Authorization: Bearer <token>`.

| Method | Path | Body | Description |
|---|---|---|---|
| POST | `/auth/register` | `{ username, password }` | Create an account. Returns `{ token, profile }`. |
| POST | `/auth/login` | `{ username, password }` | Returns `{ token, profile }`. |
| GET | `/profile` | — | Returns `{ profile }` for the current account. |
| POST | `/tank/buy` | `{ tankId }` | Validates price/currency server-side, deducts, returns `{ profile }`. |
| POST | `/tank/sell` | `{ tankId }` | Server computes the sell price, returns `{ profile }`. |
| POST | `/tank/select` | `{ tankId }` | Sets the equipped tank (must be owned). |
| POST | `/roulette/spin` | — | Server rolls the reward, returns `{ profile, reward }`. |
| POST | `/chest/open` | `{ chestId }` | Server rolls the result, returns `{ profile, result }`. |
| POST | `/battlepass/claim` | `{ tier }` | Validates XP threshold, returns `{ profile }`. |

Every mutating endpoint returns the player's **entire** updated profile.
The client should always replace its whole local copy with what comes
back, never try to predict/patch individual fields itself.

## Project structure

```
src/
  index.ts            entry point, wires up routes
  auth.ts             JWT signing/verification middleware
  types.ts            shared Profile shape
  keepAlive.ts         self-ping so Render's free tier doesn't sleep
  data/                 server-side copies of the game's pricing/reward tables
    tankCatalog.ts       (mirrors gamescripts/TankCatalog.h)
    rouletteCatalog.ts   (mirrors ProfileManager.h's Roulette namespace)
    chestCatalog.ts      (mirrors ChestCatalog.h)
    battlePass.ts        (mirrors ProfileManager.h's BattlePass namespace)
    sellPrice.ts          (mirrors GameScene::SellPriceForTank)
  db/
    schema.sql            table definitions
    migrate.ts             one-shot script that applies schema.sql
    pool.ts                 shared Postgres connection pool
    profileRepo.ts           all reads/writes to the profiles table
    withTransaction.ts        transaction + row-lock helper (see its comments
                               for why this matters -- prevents double-spend
                               races from a double-tapped button)
  routes/
    auth.ts    register/login
    profile.ts  GET current profile
    tank.ts      buy/sell/select
    roulette.ts   spin
    chest.ts       open
    battlepass.ts   claim
```

## Keeping the client's copies of pricing data in sync

The `data/` files here are **duplicates** of data that also lives in the
C++ client (`gamescripts/TankCatalog.h`, `ProfileManager.h`,
`ChestCatalog.h`). If you add a tank, change a price, or add a roulette
reward, you need to update **both** sides:

- the C++ file (what the client displays before the player taps Buy)
- the matching file under `src/data/` here (what actually gets charged)

If they drift out of sync, the player will see one price and get charged
a different one -- confusing at best, and a support headache at worst.
