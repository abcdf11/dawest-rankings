import { z } from "zod";
export const rankingEvent = z.object({
  revision: z.number().int().nonnegative(),
  match_id: z.number().int().positive(),
  updated_at: z.string(),
  event_id: z.number().int().positive(),
  players: z.array(
    z.object({ id: z.number(), rating: z.number(), rank: z.number() }),
  ),
});
export const liveEvent = z.object({
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
