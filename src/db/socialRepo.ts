import { PoolClient } from "pg";
import { pool } from "./pool";

// ============================================================================
// socialRepo — friends, direct messages, blocks.
//
// Friendships are stored as a SINGLE row per pair (requester ->
// target), not mirrored into two rows. That keeps accept/decline
// trivial (one row to update or delete) but means every read has to
// check both columns -- hence the OR conditions throughout. The
// alternative (two mirrored rows) makes reads simpler but every
// mutation has to keep both copies in sync, which is the more dangerous
// failure mode.
// ============================================================================

export interface FriendEntry {
  accountId: number;
  username: string;
  status: string;    // 'pending' | 'accepted'
  incoming: boolean; // true = they requested US and we haven't accepted yet
}

export interface DirectMessage {
  id: number;
  senderId: number;
  senderName: string;
  body: string;
  createdAt: string;
}

export async function findAccountByUsername(username: string): Promise<{ id: number; username: string } | null> {
  const res = await pool.query(
    `SELECT id, username FROM accounts WHERE LOWER(username) = LOWER($1) LIMIT 1`,
    [username]
  );
  return res.rowCount ? { id: res.rows[0].id, username: res.rows[0].username } : null;
}

// Every friendship row touching this account, in either direction, with
// the other party's username resolved.
export async function listFriends(accountId: number): Promise<FriendEntry[]> {
  const res = await pool.query(
    `SELECT f.account_id, f.friend_id, f.status,
            a1.username AS requester_name, a2.username AS target_name
     FROM friendships f
     JOIN accounts a1 ON a1.id = f.account_id
     JOIN accounts a2 ON a2.id = f.friend_id
     WHERE f.account_id = $1 OR f.friend_id = $1
     ORDER BY f.created_at DESC`,
    [accountId]
  );
  return res.rows.map((r: any) => {
    const weAreRequester = r.account_id === accountId;
    return {
      accountId: weAreRequester ? r.friend_id : r.account_id,
      username: weAreRequester ? r.target_name : r.requester_name,
      status: r.status,
      // A pending row we did NOT create is an invite waiting on us.
      incoming: !weAreRequester && r.status === "pending",
    };
  });
}

export async function areFriends(accountId: number, otherId: number): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM friendships
     WHERE status = 'accepted'
       AND ((account_id = $1 AND friend_id = $2) OR (account_id = $2 AND friend_id = $1))
     LIMIT 1`,
    [accountId, otherId]
  );
  return res.rowCount > 0;
}

// Returns 'created' | 'already' | 'accepted_reverse'. The last case is
// the nice-to-have: if they had already invited US, sending an invite
// back just accepts theirs instead of creating a second, opposite row
// that would leave both sides looking "pending" forever.
export async function sendFriendRequest(accountId: number, targetId: number): Promise<string> {
  const reverse = await pool.query(
    `SELECT id, status FROM friendships WHERE account_id = $1 AND friend_id = $2 LIMIT 1`,
    [targetId, accountId]
  );
  if (reverse.rowCount) {
    if (reverse.rows[0].status === "accepted") return "already";
    await pool.query(`UPDATE friendships SET status = 'accepted' WHERE id = $1`, [reverse.rows[0].id]);
    return "accepted_reverse";
  }

  const existing = await pool.query(
    `SELECT id FROM friendships WHERE account_id = $1 AND friend_id = $2 LIMIT 1`,
    [accountId, targetId]
  );
  if (existing.rowCount) return "already";

  await pool.query(
    `INSERT INTO friendships (account_id, friend_id, status) VALUES ($1, $2, 'pending')`,
    [accountId, targetId]
  );
  return "created";
}

// Only the TARGET of a pending request may accept it -- otherwise a
// requester could accept their own invite.
export async function acceptFriendRequest(accountId: number, requesterId: number): Promise<boolean> {
  const res = await pool.query(
    `UPDATE friendships SET status = 'accepted'
     WHERE account_id = $1 AND friend_id = $2 AND status = 'pending'`,
    [requesterId, accountId]
  );
  return (res.rowCount ?? 0) > 0;
}

// Removes the friendship/request in whichever direction it exists.
export async function removeFriend(accountId: number, otherId: number): Promise<void> {
  await pool.query(
    `DELETE FROM friendships
     WHERE (account_id = $1 AND friend_id = $2) OR (account_id = $2 AND friend_id = $1)`,
    [accountId, otherId]
  );
}

// --- Blocks ------------------------------------------------------------------

export async function isBlocked(blockerId: number, blockedId: number): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM blocks WHERE account_id = $1 AND blocked_id = $2 LIMIT 1`,
    [blockerId, blockedId]
  );
  return (res.rowCount ?? 0) > 0;
}

export async function listBlocked(accountId: number): Promise<number[]> {
  const res = await pool.query(`SELECT blocked_id FROM blocks WHERE account_id = $1`, [accountId]);
  return res.rows.map((r: any) => r.blocked_id);
}

// Blocking also drops any friendship between the two -- staying "friends"
// with someone you've blocked is a contradiction, and leaving the row
// there would keep them in your friend list with no way to message.
export async function blockAccount(accountId: number, targetId: number): Promise<void> {
  await pool.query(
    `INSERT INTO blocks (account_id, blocked_id) VALUES ($1, $2)
     ON CONFLICT (account_id, blocked_id) DO NOTHING`,
    [accountId, targetId]
  );
  await removeFriend(accountId, targetId);
}

export async function unblockAccount(accountId: number, targetId: number): Promise<void> {
  await pool.query(`DELETE FROM blocks WHERE account_id = $1 AND blocked_id = $2`, [accountId, targetId]);
}

// --- Messages ----------------------------------------------------------------

export async function insertMessage(senderId: number, recipientId: number, body: string): Promise<void> {
  await pool.query(
    `INSERT INTO direct_messages (sender_id, recipient_id, body) VALUES ($1, $2, $3)`,
    [senderId, recipientId, body]
  );
}

// Full conversation between two accounts, oldest first, capped. The cap
// is applied by taking the NEWEST rows and reversing, so a long history
// shows the most recent messages rather than the first ever sent.
export async function listConversation(accountId: number, otherId: number, limit: number): Promise<DirectMessage[]> {
  const res = await pool.query(
    `SELECT m.id, m.sender_id, m.body, m.created_at, a.username AS sender_name
     FROM direct_messages m
     JOIN accounts a ON a.id = m.sender_id
     WHERE (m.sender_id = $1 AND m.recipient_id = $2)
        OR (m.sender_id = $2 AND m.recipient_id = $1)
     ORDER BY m.id DESC
     LIMIT $3`,
    [accountId, otherId, limit]
  );
  return res.rows
    .map((r: any) => ({
      id: Number(r.id),
      senderId: r.sender_id,
      senderName: r.sender_name,
      body: r.body,
      createdAt: r.created_at,
    }))
    .reverse();
}
