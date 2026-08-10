import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { touchPresence } from "./presence";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is not set.");
}

export interface AuthedRequest extends Request {
  accountId: number;
}

// Tokens carry only the account id -- nothing else about the account (no
// username, no economy fields) so a token never goes stale just because
// the player's balance changed. It also means a leaked token can't reveal
// anything about the account beyond "this id exists and was valid to log
// in as at some point."
export function signToken(accountId: number): string {
  return jwt.sign({ accountId }, JWT_SECRET!, { expiresIn: "30d" });
}

// Applied to every route except /auth/register and /auth/login.
// Expects `Authorization: Bearer <token>`. On success, attaches
// accountId to the request so route handlers never touch the JWT
// directly -- they just read req.accountId, already verified.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed Authorization header.", code: "missing_token" });
    return;
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, JWT_SECRET!) as { accountId: number };
    (req as AuthedRequest).accountId = payload.accountId;
    // Every authenticated request counts as "this account is online" --
    // not just matchmaking traffic, so someone sitting in the Store or
    // Garage still shows up in the online count. See presence.ts for
    // the actual counting logic.
    touchPresence(payload.accountId);
    next();
  } catch (err) {
    res.status(401).json({ error: "Invalid or expired session, please log in again.", code: "invalid_token" });
  }
}
