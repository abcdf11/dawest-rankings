export type Tier = 'LEGEND' | 'OUTLAW' | 'GUNSLINGER' | 'DEPUTY' | 'ROOKIE';
export type Region = 'NA' | 'EU' | 'ASIA' | 'SA' | 'OCE';
export type MatchType = 'RANKED_1V1' | 'TOURNAMENT' | 'SHOWMATCH' | 'QUALIFIER';
export interface Form { id: number; opponent: string; opponent_username: string; result: 'W' | 'L'; score: string; event: string; played_at: string; delta: number }
export interface Player { id: number; username: string; display_name: string; region: Region; tier: Tier; avatar_url: string; accent_color: string; rating: number; previous_rating: number; peak_rating: number; rank: number; previous_rank: number; regional_rank: number; rank_delta: number; wins: number; losses: number; win_rate: number; current_streak: number; kd_ratio: number; updated_at: string; last_five: Form[] }
export interface History { recorded_at: string; rating: number; rank: number; event_label: string }
export interface PlayerDetail extends Player { history: History[]; matches: Form[] }
export interface Ladder { players: Player[]; total: number; revision: number; source: 'demo' | 'official'; updated_at: string }
export interface Simulation { delta_a: number; delta_b: number; rating_a: number; rating_b: number; expected_a: number; margin_multiplier: number; event_weight: number; players: { id: number; username: string; before: number; after: number; delta: number; rank_before: number; rank_after: number; tier: Tier }[] }
export interface LiveMatch { event_id: number; match_id: number; event: string; player_a: string; player_b: string; score_a: number; score_b: number; status: 'LIVE' }
