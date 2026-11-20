import express from "express";
import cors from "cors";
import helmet from "helmet";
import { createServer } from "node:http";
import { Redis } from "ioredis";
import { Server } from "socket.io";
import { rankingEvent, liveEvent, type LiveEvent } from "./events.js";

const origins = (
  process.env.SOCKET_ALLOWED_ORIGINS ??
  "http://localhost:5173,http://localhost:8080"
).split(",");
const app = express();
app.disable("x-powered-by");
app.use(helmet(), cors({ origin: origins }));
const server = createServer(app);
const io = new Server(server, {
  cors: { origin: origins, methods: ["GET", "POST"] },
  maxHttpBufferSize: 16_384,
  connectionStateRecovery: { maxDisconnectionDuration: 120_000 },
});
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379/0", {
  maxRetriesPerRequest: 2,
  retryStrategy: (times) => Math.min(times * 500, 10_000),
});
const subscriber = redis.duplicate();
let subscribed = false;
let closing = false;
const seen = new Set<number>();
const recent: LiveEvent[] = [];
redis.on("error", (error: Error) => console.error("Redis:", error.message));
subscriber.on("error", (error: Error) =>
  console.error("Redis subscriber:", error.message),
);
subscriber.on("close", () => {
  subscribed = false;
  io.emit("GATEWAY_STATUS", { live: false });
});
subscriber.on("ready", async () => {
  try {
    await subscriber.subscribe("rankings:updated", "match:live");
    subscribed = true;
    io.emit("GATEWAY_STATUS", { live: true });
  } catch (error) {
    console.error("Subscription failed:", error);
  }
});
subscriber.on("message", (channel: string, raw: string) => {
  try {
    const parsed: unknown = JSON.parse(raw);
    const event =
      channel === "rankings:updated"
        ? rankingEvent.parse(parsed)
        : liveEvent.parse(parsed);
    if (seen.has(event.event_id)) return;
    seen.add(event.event_id);
    if (seen.size > 10_000) seen.delete(seen.values().next().value!);
    if (channel === "rankings:updated")
      io.to("rankings").emit("RANKINGS_REFRESH", event);
    else {
      const live = liveEvent.parse(event);
      recent.unshift(live);
      recent.splice(20);
      io.to("matches").emit("MATCH_LIVE", live);
    }
  } catch (error) {
    console.error(
      "Rejected malformed Redis event:",
      error instanceof Error ? error.message : "unknown",
    );
  }
});
io.on("connection", (socket) => {
  void socket.join(["rankings", "matches"]);
  socket.emit("GATEWAY_STATUS", { live: subscribed });
  socket.on(
    "subscribe",
    (room: unknown, ack?: (value: { ok: boolean }) => void) => {
      const valid = room === "rankings" || room === "matches";
      if (valid) void socket.join(room);
      if (typeof ack === "function") ack({ ok: valid });
    },
  );
});
app.get("/health", (_req, res) =>
  res
    .status(subscribed ? 200 : 503)
    .json({
      status: subscribed ? "ok" : "degraded",
      redis: redis.status,
      subscribed,
      clients: io.engine.clientsCount,
    }),
);
app.get("/api/recent-results", (_req, res) =>
  res.json({ results: recent, source: "live" }),
);
server.listen(Number(process.env.PORT ?? 3001), "0.0.0.0", () =>
  console.log(
    "DaWest realtime gateway listening on port",
    process.env.PORT ?? 3001,
  ),
);
async function shutdown() {
  if (closing) return;
  closing = true;
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await Promise.allSettled([subscriber.quit(), redis.quit()]);
  server.close();
}
process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
