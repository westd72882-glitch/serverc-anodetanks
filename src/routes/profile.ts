import { Router } from "express";
import { requireAuth, AuthedRequest } from "../auth";
import { getProfile } from "../db/profileRepo";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const accountId = (req as AuthedRequest).accountId;
  const profile = await getProfile(accountId);
  if (!profile) {
    res.status(404).json({ error: "Profile not found.", code: "not_found" });
    return;
  }
  res.json({ profile });
});

export default router;
