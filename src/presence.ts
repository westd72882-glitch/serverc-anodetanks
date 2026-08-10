// ============================================================================
// Online presence tracking.
//
// In memory, not Postgres, same reasoning as match.ts's queue/matches
// maps: a presence timestamp is worthless the moment the process
// restarts anyway (everyone's client will just touch it again on their
// next request within seconds), and this only works correctly with
// Render's WEB_CONCURRENCY=1 single-process deployment -- if this ever
// scales to multiple instances, move it to Redis (a shared TTL set),
// otherwise each instance would only know about its own slice of
// traffic and the count would undercount.
//
// "Online" is defined as "made an authenticated request within the last
// ONLINE_WINDOW_MS" -- there's no explicit login/logout/heartbeat
// concept, just a sliding window over ordinary API traffic. touchPresence
// is called from auth.ts's requireAuth on every authenticated request,
// so anyone actively using the app (Store, Garage, a match, anything)
// counts, not just people in matchmaking.
// ============================================================================

const lastSeenAt = new Map<number, number>();

const ONLINE_WINDOW_MS = 90 * 1000; // matches the client's ~30s poll interval with margin for a couple of missed polls

export function touchPresence(accountId: number): void {
  lastSeenAt.set(accountId, Date.now());
}

export function getOnlineCount(): number {
  const cutoff = Date.now() - ONLINE_WINDOW_MS;
  let count = 0;
  for (const [accountId, seenAt] of lastSeenAt) {
    if (seenAt < cutoff) {
      // Prune while we're here rather than in a separate timer -- this
      // map is read roughly once every 20-30s (client poll interval),
      // which is a fine cadence to also garbage-collect it, and avoids
      // needing a second background interval just for cleanup.
      lastSeenAt.delete(accountId);
      continue;
    }
    count++;
  }
  return count;
}
