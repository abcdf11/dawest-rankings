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
export type PickSide = "A" | "B";
export interface EventTeam {
  slug: string;
  name: string;
  tag: string;
  url: string;
  logo_url: string;
}
export interface EventEntries {
  entries: EventTeam[];
  registration_open: boolean;
  my_teams: (EventTeam & { registered: boolean })[];
}
export interface PickemMatchup {
  id: number;
  label: string;
  option_a: string;
  option_b: string;
  team_a: EventTeam | null;
  team_b: EventTeam | null;
  points: number;
  locks_at: string;
  locked: boolean;
  winner: PickSide | null;
  my_pick: PickSide | null;
  picks?: { A: number; B: number };
}
export interface PickemStanding {
  rank: number;
  username: string;
  display_name: string;
  url: string;
  points: number;
  correct: number;
  decided: number;
  picks: number;
}
export interface PickemBoard {
  matchups: PickemMatchup[];
  leaderboard: PickemStanding[];
  me: PickemStanding | null;
  can_pick: boolean;
  participants: number;
}
