import { Router } from "express";
import { requireAuth, AuthedRequest } from "../auth";
import { getProfile } from "../db/profileRepo";

const router = Router();

// ============================================================================
// 1v1 matchmaking.
//
// State lives IN MEMORY, not in Postgres, on purpose: a queue entry is
// worthless the moment the process restarts (the player's client is gone
// too), and matches are short-lived. This is safe here specifically
// because Render runs this service with WEB_CONCURRENCY=1 -- a single
// process -- so there's exactly one queue. If this is ever scaled to
// multiple instances, this must move to Redis or Postgres, otherwise
// each instance would have its own separate queue and players would
// never find each other.
// ============================================================================

interface QueueEntry {
  accountId: number;
  username: string;
  tier: number;      // tier of the tank they queued with
  joinedAtMs: number;
}

// Players are only paired if their tank tiers are within this many levels
// of each other -- a tier-10 heavy against a tier-1 starter isn't a match,
// it's a execution.
const MAX_TIER_GAP = 1;

interface MatchPlayerState {
  x: number;
  z: number;
  hullYaw: number;
  turretYaw: number;
  health: number;
  maxHealth: number; // so the other client can draw a correct HP bar for a tank it doesn't own
  tankId: string;    // catalog id, so the opponent's nameplate can show the real tank name + tier
  dmgDealt: number;  // total damage this player has dealt to the other one; the receiver applies it to itself
  // Per-tank upgrade level (1..10). Relayed so the other client can
  // resolve this tank's real stats instead of assuming stock.
  upgradeLevel: number;
  alive: boolean;
  // Most recent shot, relayed so the opponent's client can spawn the same
  // shell locally. shotId increments per shot; the receiver only spawns
  // when it sees an id it hasn't handled yet, which makes repeated polls
  // idempotent without needing a real event queue.
  shotId: number;
  shotX: number;
  shotY: number;
  shotZ: number;
  shotYaw: number;
  shotPitch: number;
  shotDamage: number;
  // In-match chat, piggybacked on the same state exchange (see
  // gamescripts/ServerSync::MatchSendState's doc comment). chatSeq
  // increments once per message this player has SENT; chatMsg/chatNick
  // describe that most recent one. Same idempotency trick as shotId --
  // the receiver only surfaces a "new" chat line when the seq it reads
  // back is higher than the last one it already saw, so a message is
  // never duplicated across repeated polls, and a state update with
  // nothing new to say just carries the same seq/text as last time.
  chatSeq: number;
  chatNick: string;
  chatMsg: string;
  updatedAtMs: number;
}

interface Match {
  matchId: string;
  players: { accountId: number; username: string }[]; // exactly 2
  createdAtMs: number;
  state: Record<number, MatchPlayerState>; // keyed by accountId
  finished: boolean;
}

const queue: QueueEntry[] = [];
const matches = new Map<string, Match>();
const accountToMatch = new Map<number, string>(); // accountId -> matchId

// A queued client that stops polling (app killed, connection dropped) must
// not clog the queue forever.
const QUEUE_STALE_MS = 20000;
const lastSeen = new Map<number, number>();

// Finished/abandoned matches are cleaned up so memory doesn't grow without
// bound on a long-running instance.
const MATCH_MAX_AGE_MS = 20 * 60 * 1000;

function pruneStale() {
  const now = Date.now();
  for (let i = queue.length - 1; i >= 0; i--) {
    const seen = lastSeen.get(queue[i].accountId) ?? queue[i].joinedAtMs;
    if (now - seen > QUEUE_STALE_MS) {
      queue.splice(i, 1);
    }
  }
  for (const [id, m] of matches) {
    if (now - m.createdAtMs > MATCH_MAX_AGE_MS) {
      for (const p of m.players) accountToMatch.delete(p.accountId);
      matches.delete(id);
    }
  }
}

function tryPair() {
  // Oldest-first so nobody starves: for each waiting player, look for the
  // longest-waiting opponent within MAX_TIER_GAP tiers. Anyone with no
  // valid partner simply stays queued.
  for (let i = 0; i < queue.length; i++) {
    let partnerIdx = -1;
    for (let j = i + 1; j < queue.length; j++) {
      if (Math.abs(queue[i].tier - queue[j].tier) <= MAX_TIER_GAP) {
        partnerIdx = j;
        break;
      }
    }
    if (partnerIdx < 0) continue;

    const a = queue[i];
    const b = queue[partnerIdx];
    queue.splice(partnerIdx, 1);
    queue.splice(i, 1);
    i = -1; // restart the scan, indices shifted
    const matchId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const match: Match = {
      matchId,
      players: [
        { accountId: a.accountId, username: a.username },
        { accountId: b.accountId, username: b.username },
      ],
      createdAtMs: Date.now(),
      state: {},
      finished: false,
    };
    matches.set(matchId, match);
    accountToMatch.set(a.accountId, matchId);
    accountToMatch.set(b.accountId, matchId);
  }
}

// Both /queue/join and /queue/status must describe a match the SAME way.
// They didn't before: join replied with just {status,matchId}, so a client
// that got paired at the moment it joined never learned its side or the
// opponent's name -- it fell back to side 0 and a blank name. With both
// clients defaulting to side 0 they spawned on top of each other, and the
// nameplate showed a placeholder instead of the real player.
function matchedPayload(matchId: string, accountId: number, queueSize: number) {
  const m = matches.get(matchId)!;
  const opponent = m.players.find((p) => p.accountId !== accountId);
  return {
    status: "matched",
    matchId,
    opponentUsername: opponent?.username ?? "Opponent",
    side: m.players[0].accountId === accountId ? 0 : 1,
    queueSize,
  };
}

function removeFromQueue(accountId: number) {
  const idx = queue.findIndex((e) => e.accountId === accountId);
  if (idx >= 0) queue.splice(idx, 1);
}

// --- Queue -----------------------------------------------------------------

router.post("/queue/join", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  pruneStale();

  // Already in a match -- hand that back instead of queueing twice.
  const existing = accountToMatch.get(accountId);
  if (existing && matches.has(existing)) {
    res.json(matchedPayload(existing, accountId, queue.length));
    return;
  }

  if (!queue.some((e) => e.accountId === accountId)) {
    const profile = await getProfile(accountId);
    // Tier comes from the client (it knows which tank is equipped); clamped
    // to the real 1-10 range so a bad or forged value can't dodge the
    // matchmaking rules by claiming tier 0 or 99.
    const rawTier = Number((req.body ?? {}).tier);
    const tier = Math.max(1, Math.min(10, Number.isFinite(rawTier) ? Math.trunc(rawTier) : 1));
    queue.push({
      accountId,
      username: profile?.username ?? `player${accountId}`,
      tier,
      joinedAtMs: Date.now(),
    });
  }
  lastSeen.set(accountId, Date.now());
  tryPair();

  const matchId = accountToMatch.get(accountId);
  if (matchId && matches.has(matchId)) {
    res.json(matchedPayload(matchId, accountId, queue.length));
    return;
  }
  const entry = queue.find((e) => e.accountId === accountId);
  res.json({
    status: "queued",
    queueSize: queue.length,
    waitSeconds: entry ? Math.floor((Date.now() - entry.joinedAtMs) / 1000) : 0,
  });
});

router.post("/queue/leave", requireAuth, (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  removeFromQueue(accountId);
  lastSeen.delete(accountId);
  res.json({ status: "left", queueSize: queue.length });
});

// Polled by a waiting client roughly once a second: refreshes its
// keep-alive stamp, reports how many players are waiting globally and how
// long this one has been waiting, and flips to "matched" the moment a
// pairing happens.
router.get("/queue/status", requireAuth, (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  pruneStale();
  lastSeen.set(accountId, Date.now());
  tryPair();

  const matchId = accountToMatch.get(accountId);
  if (matchId && matches.has(matchId)) {
    // Index in players[] decides spawn side, so both clients agree on
    // who starts where without any extra negotiation.
    res.json(matchedPayload(matchId, accountId, queue.length));
    return;
  }

  // Per-tier breakdown of everyone waiting, so the client can show a
  // table ("tier VII: 2 players") instead of just a total -- with
  // MAX_TIER_GAP pairing, knowing WHICH tiers are queued is what tells a
  // player whether their wait is likely to end soon.
  const tierCounts: number[] = new Array(11).fill(0); // index = tier, 1..10
  for (const e of queue) {
    const t = Math.max(1, Math.min(10, e.tier));
    tierCounts[t]++;
  }

  const entry = queue.find((e) => e.accountId === accountId);
  if (!entry) {
    res.json({ status: "idle", queueSize: queue.length, tierCounts });
    return;
  }
  res.json({
    status: "queued",
    queueSize: queue.length,
    waitSeconds: Math.floor((Date.now() - entry.joinedAtMs) / 1000),
    myTier: entry.tier,
    tierCounts,
  });
});

// --- In-match state exchange ------------------------------------------------
// Simple "push mine, pull theirs" over plain HTTP. Not a real-time
// netcode stack -- there's no interpolation, prediction or lag
// compensation here -- but it's a genuine networked exchange between the
// two paired clients rather than a local bot pretending to be a player.

router.post("/state", requireAuth, (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const matchId = accountToMatch.get(accountId);
  if (!matchId || !matches.has(matchId)) {
    res.status(404).json({ error: "Not in a match.", code: "no_match" });
    return;
  }
  const m = matches.get(matchId)!;
  const b = req.body ?? {};
  const { x, z, hullYaw, turretYaw, health, alive } = b;
  // Values arrive pre-scaled as integers from the client (x/z are x100,
  // yaws are x1000 -- see ServerSync::MatchSendState) and are relayed
  // back out in exactly the same units, so the server never has to know
  // anything about world scale or angle conventions.
  m.state[accountId] = {
    x: Math.trunc(Number(x) || 0),
    z: Math.trunc(Number(z) || 0),
    hullYaw: Math.trunc(Number(hullYaw) || 0),
    turretYaw: Math.trunc(Number(turretYaw) || 0),
    health: Math.trunc(Number(health) || 0),
    maxHealth: Math.trunc(Number(b.maxHealth) || 0),
    tankId: typeof b.tankId === "string" ? b.tankId.slice(0, 64) : "",
    dmgDealt: Math.max(0, Math.trunc(Number(b.dmgDealt) || 0)),
    upgradeLevel: Math.min(10, Math.max(1, Math.trunc(Number(b.upgradeLevel) || 1))),
    alive: alive !== false,
    shotId: Math.trunc(Number(b.shotId) || 0),
    shotX: Math.trunc(Number(b.shotX) || 0),
    shotY: Math.trunc(Number(b.shotY) || 0),
    shotZ: Math.trunc(Number(b.shotZ) || 0),
    shotYaw: Math.trunc(Number(b.shotYaw) || 0),
    shotPitch: Math.trunc(Number(b.shotPitch) || 0),
    shotDamage: Math.trunc(Number(b.shotDamage) || 0),
    // Chat: only overwrite the stored seq/nick/msg when the client sent a
    // HIGHER seq than what's already recorded -- a plain state update
    // with nothing new to say arrives with chatSeq=0 (see
    // ServerSync::MatchSendState), which must NOT clobber the last real
    // message with blanks before the opponent has had a chance to read
    // it back.
    ...(() => {
      const prev = m.state[accountId];
      const incomingSeq = Math.trunc(Number(b.chatSeq) || 0);
      if (incomingSeq > 0 && incomingSeq > (prev?.chatSeq ?? 0) && typeof b.chatMsg === "string" && b.chatMsg.length > 0) {
        return {
          chatSeq: incomingSeq,
          chatNick: typeof b.chatNick === "string" ? b.chatNick.slice(0, 32) : "",
          chatMsg: b.chatMsg.slice(0, 140),
        };
      }
      // Nothing new -- carry the previous chat fields forward unchanged
      // so they're still there to hand back on the NEXT poll too (the
      // opponent might not have read this response yet).
      return {
        chatSeq: prev?.chatSeq ?? 0,
        chatNick: prev?.chatNick ?? "",
        chatMsg: prev?.chatMsg ?? "",
      };
    })(),
    updatedAtMs: Date.now(),
  };

  const opponent = m.players.find((p) => p.accountId !== accountId);
  const opponentState = opponent ? m.state[opponent.accountId] : undefined;
  // hasOpponent lets the client tell "no state from them yet" apart from
  // "they're at the origin", without needing null-handling in its
  // minimal JSON reader.
  // opponentAgeMs is how long ago their last update arrived. The client
  // uses it to detect a disconnect: previously the server kept handing
  // back their final frozen state forever, so "no fresh data" was
  // indistinguishable from "standing still" and a rage-quit left the
  // match hanging against an invincible statue.
  res.json({
    matchId,
    finished: m.finished,
    hasOpponent: !!opponentState,
    opponentAgeMs: opponentState ? Date.now() - opponentState.updatedAtMs : 999999,
    opponent: opponentState ?? {
      x: 0, z: 0, hullYaw: 0, turretYaw: 0, health: 0, maxHealth: 0, tankId: "", dmgDealt: 0, upgradeLevel: 1, alive: false,
      shotId: 0, shotX: 0, shotY: 0, shotZ: 0, shotYaw: 0, shotPitch: 0, shotDamage: 0,
      chatSeq: 0, chatNick: "", chatMsg: "", updatedAtMs: 0,
    },
    // Opponent's chat surfaced as top-level fields (not nested under
    // "opponent") since it's conceptually about THIS exchange, not part
    // of their tank's transform/health -- keeps GameGameplay.cpp's
    // parsing of the two concerns separate.
    opponentChatSeq: opponentState?.chatSeq ?? 0,
    opponentChatNick: opponentState?.chatNick ?? "",
    opponentChatMsg: opponentState?.chatMsg ?? "",
  });
});

// Reports the match as over (someone died / player left) so both sides
// stop exchanging state and the entry can be cleaned up.
router.post("/finish", requireAuth, (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const matchId = accountToMatch.get(accountId);
  if (matchId && matches.has(matchId)) {
    const m = matches.get(matchId)!;
    m.finished = true;
    for (const p of m.players) accountToMatch.delete(p.accountId);
    matches.delete(matchId);
  }
  removeFromQueue(accountId);
  res.json({ status: "finished" });
});

export default router;
