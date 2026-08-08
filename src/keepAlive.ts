import http from "http";
import https from "https";

// Render's free tier puts a Web Service to sleep after ~15 minutes with
// no incoming traffic, and the next real request then pays a slow
// cold-start penalty (tens of seconds) while it wakes back up -- bad for
// a player who just wants to log in. Pinging our own /health endpoint
// well under that 15-minute window keeps the instance counted as "active"
// so it never sleeps.
//
// This only runs if SELF_URL is set (see .env.example) -- deliberately
// opt-in so local development and any future non-Render deployment
// doesn't spam a pointless self-request loop.
export function startKeepAlive() {
  const selfUrl = process.env.SELF_URL;
  if (!selfUrl) {
    console.log("SELF_URL not set -- skipping self-ping keep-alive.");
    return;
  }

  const target = new URL("/health", selfUrl);
  const client = target.protocol === "https:" ? https : http;
  const intervalMs = 30 * 1000;

  setInterval(() => {
    const req = client.get(target, (res) => {
      res.resume(); // drain the response so the socket can be reused/closed cleanly
    });
    req.on("error", (err) => {
      // Don't crash the server over a failed keep-alive ping -- just log
      // it and try again next interval.
      console.warn("Self-ping failed:", err.message);
    });
  }, intervalMs);

  console.log(`Self-ping keep-alive started, pinging ${target.toString()} every 30s.`);
}
