export type Tier = "LEGEND" | "OUTLAW" | "GUNSLINGER" | "DEPUTY" | "ROOKIE";
export type Region = "NA" | "EU" | "ASIA" | "SA" | "OCE";
export type MatchType =
  | "RANKED_1V1"
  | "RANKED_TEAM"
  | "TOURNAMENT"
  | "SHOWMATCH"
  | "QUALIFIER";
export type RankingKind = "players" | "teams";
export interface Form {
  id: number;
  opponent: string;
  opponent_username: string;
  result: "W" | "L";
  score: string;
  event: string;
  played_at: string;
  delta: number;
}
export interface RankedCompetitor {
  id: number;
  username: string;
  display_name: string;
  region: Region;
  tier: Tier;
  avatar_url: string;
  accent_color: string;
  rating: number;
  previous_rating: number;
  peak_rating: number;
  rank: number;
  previous_rank: number;
  regional_rank: number;
  rank_delta: number;
  wins: number;
  losses: number;
  win_rate: number;
  current_streak: number;
  kd_ratio: number;
  updated_at: string;
  last_five: Form[];
}
export interface TeamSummary {
  username: string;
  display_name: string;
  tag: string;
}
export interface Player extends RankedCompetitor {
  team?: TeamSummary | null;
}
export interface Team extends RankedCompetitor {
  kind: "teams";
  is_verified?: boolean;
  tag: string;
  roster: Player[];
}
export type RankingEntry = Player | Team;
export interface History {
  recorded_at: string;
  rating: number;
  rank: number;
  event_label: string;
}
export interface PlayerDetail extends Player {
  is_restricted?: boolean;
  banner_url?: string;
  audio_url?: string;
  audio_title?: string;
  registered_at?: string | null;
  rounds_won?: number;
  rounds_lost?: number;
  roblox_username?: string | null;
  history: History[];
  matches: Form[];
  koh?: KohSummary;
}
export interface KohRoundResult {
  round_id: string;
  mode: "SOLO" | "FACTION";
  ended_at: string;
  kills: number;
  deaths: number;
  placement: number;
  players: number;
  is_winner: boolean;
  rating_delta: number | null;
}
export interface KohSummary {
  rounds: number;
  wins: number;
  kills: number;
  deaths: number;
  kd: number;
  recent: KohRoundResult[];
}
export interface TeamDetail extends Team {
  history: History[];
  matches: Form[];
}
export interface TeamLadder {
  teams: Team[];
  total: number;
  revision: number;
  source: "demo" | "official";
  updated_at: string;
}
export interface Ladder<T extends RankedCompetitor = Player> {
  realtime_enabled?: boolean;
  players: T[];
  total: number;
  revision: number;
  source: "demo" | "official";
  updated_at: string;
}
export interface LiveMatch {
  kind?: RankingKind;
  event_id: number;
  match_id: number;
  event: string;
  player_a: string;
  player_b: string;
  score_a: number;
  score_b: number;
  status: "LIVE";
}
