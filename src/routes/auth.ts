import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db/pool";
import { withTransaction } from "../db/withTransaction";
import { createProfile, getProfile, touchLastLogin } from "../db/profileRepo";
import { signToken } from "../auth";

const router = Router();

const USERNAME_MIN = 3;
const USERNAME_MAX = 20;
const PASSWORD_MIN = 6;
// Letters, digits, underscore only -- keeps usernames simple to type on a
// mobile keyboard and avoids anything that could look confusing/be used
// for impersonation tricks (no leading/trailing spaces, no lookalike
// unicode).
const USERNAME_PATTERN = /^[A-Za-z0-9_]+$/;

router.post("/register", async (req, res) => {
  const { username, password } = req.body ?? {};

  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Username and password are required.", code: "invalid_input" });
    return;
  }
  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX || !USERNAME_PATTERN.test(username)) {
    res.status(400).json({
      error: `Username must be ${USERNAME_MIN}-${USERNAME_MAX} characters, letters/digits/underscore only.`,
      code: "invalid_username",
    });
    return;
  }
  if (password.length < PASSWORD_MIN) {
    res.status(400).json({ error: `Password must be at least ${PASSWORD_MIN} characters.`, code: "invalid_password" });
    return;
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);

    const { accountId, profile } = await withTransaction(async (client) => {
      const insertResult = await client.query(
        `INSERT INTO accounts (username, password_hash) VALUES ($1, $2) RETURNING id`,
        [username, passwordHash]
      );
      const accountId: number = insertResult.rows[0].id;
      await createProfile(accountId, client);
      const profile = await getProfile(accountId, client);
      return { accountId, profile };
    });

    const token = signToken(accountId);
    res.status(201).json({ token, profile });
  } catch (err: any) {
    // Postgres unique_violation on the case-insensitive username index.
    if (err.code === "23505") {
      res.status(409).json({ error: "That username is already taken.", code: "username_taken" });
      return;
    }
    console.error("register failed:", err);
    res.status(500).json({ error: "Registration failed, please try again.", code: "internal_error" });
  }
});

router.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (typeof username !== "string" || typeof password !== "string") {
    res.status(400).json({ error: "Username and password are required.", code: "invalid_input" });
    return;
  }

  try {
    const result = await pool.query(
      `SELECT id, password_hash FROM accounts WHERE LOWER(username) = LOWER($1)`,
      [username]
    );
    if (result.rows.length === 0) {
      // Deliberately the same error for "no such user" and "wrong
      // password" below -- distinguishing them lets an attacker enumerate
      // which usernames exist.
      res.status(401).json({ error: "Incorrect username or password.", code: "invalid_credentials" });
      return;
    }

    const { id: accountId, password_hash: passwordHash } = result.rows[0];
    const passwordOk = await bcrypt.compare(password, passwordHash);
    if (!passwordOk) {
      res.status(401).json({ error: "Incorrect username or password.", code: "invalid_credentials" });
      return;
    }

    await touchLastLogin(accountId);
    const profile = await getProfile(accountId);
    const token = signToken(accountId);
    res.json({ token, profile });
  } catch (err) {
    console.error("login failed:", err);
    res.status(500).json({ error: "Login failed, please try again.", code: "internal_error" });
  }
});

export default router;
