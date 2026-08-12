import { Router } from "express";
import { requireAuth, AuthedRequest } from "../auth";
import {
  findAccountByUsername, listFriends, areFriends,
  sendFriendRequest, acceptFriendRequest, removeFriend,
  isBlocked, listBlocked, blockAccount, unblockAccount,
  insertMessage, listConversation,
} from "../db/socialRepo";

// ============================================================================
// Social API: friends by username, direct messages, blocking.
//
//   GET  /social/friends                    -- friend list + pending invites
//   POST /social/friends/add    { username }
//   POST /social/friends/accept { accountId }
//   POST /social/friends/remove { accountId }
//   POST /social/block          { accountId }
//   POST /social/unblock        { accountId }
//   GET  /social/messages/:accountId        -- conversation, oldest first
//   POST /social/messages       { accountId, body }
//
// Messaging is restricted to ACCEPTED friends. That's the single most
// effective anti-harassment measure available here: a stranger cannot
// open a conversation at all, so blocking is a backstop rather than the
// only line of defence.
// ============================================================================

const router = Router();

const MAX_MESSAGE_LEN = 500;
const CONVERSATION_LIMIT = 100;

router.get("/friends", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  try {
    const [friends, blocked] = await Promise.all([listFriends(accountId), listBlocked(accountId)]);
    const blockedSet = new Set(blocked);
    res.json({
      friends: friends.map((f) => ({ ...f, blocked: blockedSet.has(f.accountId) })),
      blocked,
    });
  } catch (err) {
    console.error("social/friends failed:", err);
    res.status(500).json({ error: "Could not load friends.", code: "internal_error" });
  }
});

router.post("/friends/add", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const { username } = req.body ?? {};
  if (typeof username !== "string" || !username.trim()) {
    res.status(400).json({ error: "username is required.", code: "invalid_input" });
    return;
  }

  try {
    const target = await findAccountByUsername(username.trim());
    if (!target) {
      res.status(404).json({ error: "No player with that name.", code: "not_found" });
      return;
    }
    if (target.id === accountId) {
      res.status(400).json({ error: "You can't add yourself.", code: "self_add" });
      return;
    }
    // Refuse in BOTH directions: if either party has blocked the other,
    // no request should get through. Reporting the same generic "can't
    // add" either way avoids leaking to a blocked user that they were
    // specifically blocked.
    const [weBlockedThem, theyBlockedUs] = await Promise.all([
      isBlocked(accountId, target.id),
      isBlocked(target.id, accountId),
    ]);
    if (weBlockedThem || theyBlockedUs) {
      res.status(403).json({ error: "Can't send a request to that player.", code: "blocked" });
      return;
    }

    const result = await sendFriendRequest(accountId, target.id);
    res.json({ result, accountId: target.id, username: target.username });
  } catch (err) {
    console.error("social/friends/add failed:", err);
    res.status(500).json({ error: "Could not send the request.", code: "internal_error" });
  }
});

router.post("/friends/accept", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const targetId = Number((req.body ?? {}).accountId);
  if (!Number.isInteger(targetId)) {
    res.status(400).json({ error: "accountId is required.", code: "invalid_input" });
    return;
  }
  try {
    const ok = await acceptFriendRequest(accountId, targetId);
    if (!ok) {
      res.status(404).json({ error: "No pending request from that player.", code: "not_found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    console.error("social/friends/accept failed:", err);
    res.status(500).json({ error: "Could not accept the request.", code: "internal_error" });
  }
});

router.post("/friends/remove", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const targetId = Number((req.body ?? {}).accountId);
  if (!Number.isInteger(targetId)) {
    res.status(400).json({ error: "accountId is required.", code: "invalid_input" });
    return;
  }
  try {
    await removeFriend(accountId, targetId);
    res.json({ ok: true });
  } catch (err) {
    console.error("social/friends/remove failed:", err);
    res.status(500).json({ error: "Could not remove that friend.", code: "internal_error" });
  }
});

router.post("/block", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const targetId = Number((req.body ?? {}).accountId);
  if (!Number.isInteger(targetId) || targetId === accountId) {
    res.status(400).json({ error: "accountId is required.", code: "invalid_input" });
    return;
  }
  try {
    await blockAccount(accountId, targetId);
    res.json({ ok: true });
  } catch (err) {
    console.error("social/block failed:", err);
    res.status(500).json({ error: "Could not block that player.", code: "internal_error" });
  }
});

router.post("/unblock", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const targetId = Number((req.body ?? {}).accountId);
  if (!Number.isInteger(targetId)) {
    res.status(400).json({ error: "accountId is required.", code: "invalid_input" });
    return;
  }
  try {
    await unblockAccount(accountId, targetId);
    res.json({ ok: true });
  } catch (err) {
    console.error("social/unblock failed:", err);
    res.status(500).json({ error: "Could not unblock that player.", code: "internal_error" });
  }
});

router.get("/messages/:accountId", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const otherId = Number(req.params.accountId);
  if (!Number.isInteger(otherId)) {
    res.status(400).json({ error: "accountId is required.", code: "invalid_input" });
    return;
  }
  try {
    // Reading a conversation with someone you've blocked is allowed --
    // the history is yours, and hiding it would look like data loss.
    // Only NEW messages from them are refused (see POST below).
    const messages = await listConversation(accountId, otherId, CONVERSATION_LIMIT);
    res.json({ messages });
  } catch (err) {
    console.error("social/messages GET failed:", err);
    res.status(500).json({ error: "Could not load messages.", code: "internal_error" });
  }
});

router.post("/messages", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const { accountId: rawTarget, body } = req.body ?? {};
  const targetId = Number(rawTarget);
  if (!Number.isInteger(targetId) || typeof body !== "string" || !body.trim()) {
    res.status(400).json({ error: "accountId and body are required.", code: "invalid_input" });
    return;
  }

  try {
    // Friendship required. This is what stops cold-open harassment
    // entirely rather than relying on the victim to block afterwards.
    if (!(await areFriends(accountId, targetId))) {
      res.status(403).json({ error: "You can only message friends.", code: "not_friends" });
      return;
    }
    const [weBlockedThem, theyBlockedUs] = await Promise.all([
      isBlocked(accountId, targetId),
      isBlocked(targetId, accountId),
    ]);
    if (weBlockedThem || theyBlockedUs) {
      res.status(403).json({ error: "Can't message that player.", code: "blocked" });
      return;
    }

    await insertMessage(accountId, targetId, body.trim().slice(0, MAX_MESSAGE_LEN));
    res.json({ ok: true });
  } catch (err) {
    console.error("social/messages POST failed:", err);
    res.status(500).json({ error: "Could not send the message.", code: "internal_error" });
  }
});

export default router;
