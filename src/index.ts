import * as dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import { requireAuth } from "./auth";
import { startKeepAlive } from "./keepAlive";

import authRoutes from "./routes/auth";
import profileRoutes from "./routes/profile";
import tankRoutes from "./routes/tank";
import rouletteRoutes from "./routes/roulette";
import chestRoutes from "./routes/chest";
import battlepassRoutes from "./routes/battlepass";

const app = express();
app.use(cors());
app.use(express.json());

// Health check -- used both by Render itself (to know the service is
// alive) and by our own self-ping (see keepAlive.ts). Deliberately does
// NOT touch the database, so it stays fast and can't itself become a
// source of downtime if the DB is briefly unreachable.
app.get("/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

// /auth/* is the only unauthenticated surface -- everything else below
// requires a valid token (see src/auth.ts requireAuth).
app.use("/auth", authRoutes);

app.use("/profile", requireAuth, profileRoutes);
app.use("/tank", requireAuth, tankRoutes);
app.use("/roulette", requireAuth, rouletteRoutes);
app.use("/chest", requireAuth, chestRoutes);
app.use("/battlepass", requireAuth, battlepassRoutes);

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  startKeepAlive();
});
