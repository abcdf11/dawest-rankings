export type EventStatus = "UPCOMING" | "LIVE" | "COMPLETED" | "CANCELLED";
export interface CompetitionEvent {
  id: string;
  title: string;
  description: string;
  format: "SOLO" | "FACTION";
  region: string;
  location: string;
  starts_at: string;
  ends_at: string | null;
  status: EventStatus;
  registration_url: string;
  url: string;
  updated_at: string;
  is_published?: boolean;
  configured_status?: EventStatus;
}
export interface EventMatch {
  id: number;
  a: { name: string; url: string };
  b: { name: string; url: string };
  score_a: number;
  score_b: number;
  played_at: string;
  status: string;
}
export interface EventDetail extends CompetitionEvent {
  matches: EventMatch[];
}
