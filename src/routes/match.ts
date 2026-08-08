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
  joinedAtMs: number;
}

interface MatchPlayerState {
  x: number;
  z: number;
  hullYaw: number;
  turretYaw: number;
  health: number;
  alive: boolean;
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
  while (queue.length >= 2) {
    const a = queue.shift()!;
    const b = queue.shift()!;
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
    res.json({ status: "matched", matchId: existing, queueSize: queue.length });
    return;
  }

  if (!queue.some((e) => e.accountId === accountId)) {
    const profile = await getProfile(accountId);
    queue.push({
      accountId,
      username: profile?.username ?? `player${accountId}`,
      joinedAtMs: Date.now(),
    });
  }
  lastSeen.set(accountId, Date.now());
  tryPair();

  const matchId = accountToMatch.get(accountId);
  if (matchId && matches.has(matchId)) {
    res.json({ status: "matched", matchId, queueSize: queue.length });
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
    const m = matches.get(matchId)!;
    const opponent = m.players.find((p) => p.accountId !== accountId);
    res.json({
      status: "matched",
      matchId,
      opponentUsername: opponent?.username ?? "Opponent",
      // Index in players[] decides spawn side, so both clients agree on
      // who starts where without any extra negotiation.
      side: m.players[0].accountId === accountId ? 0 : 1,
      queueSize: queue.length,
    });
    return;
  }

  const entry = queue.find((e) => e.accountId === accountId);
  if (!entry) {
    res.json({ status: "idle", queueSize: queue.length });
    return;
  }
  res.json({
    status: "queued",
    queueSize: queue.length,
    waitSeconds: Math.floor((Date.now() - entry.joinedAtMs) / 1000),
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
  const { x, z, hullYaw, turretYaw, health, alive } = req.body ?? {};
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
    alive: alive !== false,
    updatedAtMs: Date.now(),
  };

  const opponent = m.players.find((p) => p.accountId !== accountId);
  const opponentState = opponent ? m.state[opponent.accountId] : undefined;
  // hasOpponent lets the client tell "no state from them yet" apart from
  // "they're at the origin", without needing null-handling in its
  // minimal JSON reader.
  res.json({
    matchId,
    finished: m.finished,
    hasOpponent: !!opponentState,
    opponent: opponentState ?? { x: 0, z: 0, hullYaw: 0, turretYaw: 0, health: 0, alive: false, updatedAtMs: 0 },
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
