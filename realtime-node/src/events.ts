import { z } from "zod";
export const rankingEvent = z
  .object({
    kind: z.enum(["players", "teams"]).default("players"),
    revision: z.number().int().nonnegative(),
    match_id: z.number().int().positive().optional(),
    reason: z.enum(["match", "registration", "moderation"]).default("match"),
    operation_id: z.string().uuid().optional(),
    registration_id: z.string().uuid().optional(),
    updated_at: z.string(),
    event_id: z.number().int().positive(),
    players: z.array(
      z.object({ id: z.number(), rating: z.number(), rank: z.number() }),
    ),
  })
  .refine(
    (event) =>
      event.reason === "registration"
        ? Boolean(event.registration_id)
        : event.reason === "moderation"
          ? Boolean(event.operation_id)
          : Boolean(event.match_id),
    { message: "An event needs its match, registration, or moderation identifier." },
  );
export const liveEvent = z.object({
  kind: z.enum(["players", "teams"]).default("players"),
  event_id: z.number().int().positive(),
  match_id: z.number().int().positive(),
  event: z.string().max(120),
  player_a: z.string().max(64),
  player_b: z.string().max(64),
  score_a: z.number().int().min(0).max(100),
  score_b: z.number().int().min(0).max(100),
  status: z.literal("LIVE"),
});
export type LiveEvent = z.infer<typeof liveEvent>;
