import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { requireAuth } from "./auth";
import { startKeepAlive } from "./keepAlive";
import { getPromoCodes } from "./promo";

import authRoutes from "./routes/auth";
import profileRoutes from "./routes/profile";
import tankRoutes from "./routes/tank";
import skinRoutes from "./routes/skin";
import silverRoutes from "./routes/silver";
import rouletteRoutes from "./routes/roulette";
import chestRoutes from "./routes/chest";
import battlepassRoutes from "./routes/battlepass";
import battleRoutes from "./routes/battle";
import matchRoutes from "./routes/match";
import promoRoutes from "./routes/promo";
import onlineRoutes from "./routes/online";

const app = express();
app.use(cors());
app.use(express.json());

// Health check -- used both by Render itself (to know the service is
// alive) and by our own self-ping (see keepAlive.ts). Deliberately does
// NOT touch the database, so it stays fast and can't itself become a
// source of downtime if the DB is briefly unreachable.
// Minimum client version allowed to play. Bump this on every release
// that changes anything the client and server must agree on (economy
// numbers, match protocol, catalog contents) -- older clients are then
// refused at startup instead of silently running against rules they
// don't share, which is how desyncs and "my money disappeared" reports
// start. Format is "major.minor.patch", compared numerically per part.
const MIN_CLIENT_VERSION = "1.0.0";

// Health check -- used by Render, by our own self-ping (keepAlive.ts) and
// by the client's startup connectivity probe, which also reads the
// version requirement out of this same response so startup needs one
// round trip rather than two.
app.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString(), minVersion: MIN_CLIENT_VERSION });
});

// /auth/* is the only unauthenticated surface -- everything else below
// requires a valid token (see src/auth.ts requireAuth).
app.use("/auth", authRoutes);

app.use("/profile", requireAuth, profileRoutes);
app.use("/tank", requireAuth, tankRoutes);
app.use("/skin", requireAuth, skinRoutes);
app.use("/silver", requireAuth, silverRoutes);
app.use("/roulette", requireAuth, rouletteRoutes);
app.use("/chest", requireAuth, chestRoutes);
app.use("/battlepass", requireAuth, battlepassRoutes);
app.use("/battle", requireAuth, battleRoutes);
app.use("/match", requireAuth, matchRoutes);
app.use("/promo", requireAuth, promoRoutes);
app.use("/online", requireAuth, onlineRoutes);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  // Parse PROMOCODE now rather than on first redeem, so a typo in the
  // env var shows up in the deploy log instead of at the moment a player
  // tries to use it.
  getPromoCodes();
  startKeepAlive();
});
