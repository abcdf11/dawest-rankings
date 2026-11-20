import assert from "node:assert/strict";
import test from "node:test";
import { liveEvent, rankingEvent } from "./events.js";
test("accepts a committed ranking event and rejects missing revision", () => {
  const event = {
    event_id: 4,
    revision: 3,
    match_id: 2,
    updated_at: new Date().toISOString(),
    players: [{ id: 1, rating: 1600, rank: 2 }],
  };
  assert.equal(rankingEvent.safeParse(event).success, true);
  assert.equal(
    rankingEvent.safeParse({ ...event, revision: undefined }).success,
    false,
  );
});
test("rejects invalid live scores and unbounded player names", () => {
  const event = {
    event_id: 1,
    match_id: 1,
    event: "Open",
    player_a: "Deadeye",
    player_b: "Vex",
    score_a: 5,
    score_b: 2,
    status: "LIVE",
  };
  assert.equal(liveEvent.safeParse(event).success, true);
  assert.equal(liveEvent.safeParse({ ...event, score_a: -1 }).success, false);
  assert.equal(
    liveEvent.safeParse({ ...event, player_a: "x".repeat(65) }).success,
    false,
  );
});
test("retains team identity and defaults legacy events to players", () => {
  const event = {
    event_id: 1,
    match_id: 1,
    event: "Team Open",
    player_a: "Blackwater",
    player_b: "Red Mesa",
    score_a: 5,
    score_b: 2,
    status: "LIVE",
  };
  assert.equal(liveEvent.parse(event).kind, "players");
  assert.equal(liveEvent.parse({ ...event, kind: "teams" }).kind, "teams");
  assert.equal(
    liveEvent.safeParse({ ...event, kind: "invalid" }).success,
    false,
  );
});
test("accepts registration refreshes with their own identifier", () => {
  const event = {
    event_id: 22,
    reason: "registration",
    registration_id: "c4b26b63-ef02-4b51-bc94-f577291590fb",
    kind: "teams",
    revision: 10,
    updated_at: new Date().toISOString(),
    players: [{ id: 11, rating: 1500, rank: 7 }],
  };
  assert.equal(rankingEvent.safeParse(event).success, true);
  assert.equal(
    rankingEvent.safeParse({ ...event, registration_id: undefined }).success,
    false,
  );
});

test("accepts moderation refreshes only with an operation identifier", () => {
  const event = {
    event_id: 23,
    reason: "moderation",
    operation_id: "c4b26b63-ef02-4b51-bc94-f577291590fb",
    kind: "players",
    revision: 11,
    updated_at: new Date().toISOString(),
    players: [],
  };
  assert.equal(rankingEvent.safeParse(event).success, true);
  assert.equal(
    rankingEvent.safeParse({ ...event, operation_id: undefined }).success,
    false,
  );
});
