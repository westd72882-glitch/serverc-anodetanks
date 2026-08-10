import { Router } from "express";
import { requireAuth } from "../auth";
import { getOnlineCount } from "../presence";

// ============================================================================
// GET /online/count -- current online player count (see presence.ts for
// the definition). Requires auth like everything else, which is also
// what feeds the count itself: requireAuth calls touchPresence on every
// authenticated request, so simply calling this endpoint counts as
// activity too.
// ============================================================================

const router = Router();

router.get("/count", requireAuth, (req, res) => {
  res.json({ online: getOnlineCount() });
});

export default router;
