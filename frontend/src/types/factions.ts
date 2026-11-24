import type { Player, TeamDetail } from "./rankings";

export interface FactionSummary {
  id: number;
  username: string;
  display_name: string;
  tag: string;
  region: string;
  avatar_url: string;
  banner_url: string;
  rating: number;
  rank: number;
  is_verified?: boolean;
  profile_url: string;
  member_count?: number;
  capacity?: number;
}
export interface FactionMember extends Player {
  is_leader: boolean;
  is_captain: boolean;
  joined_at: string;
}
export interface FactionDetail extends TeamDetail {
  banner_url: string;
  audio_url: string;
  audio_title: string;
  description: string;
  registered_at: string;
  leader: FactionMember | null;
  members: FactionMember[];
  member_count: number;
  capacity: number;
  profile_url: string;
  roblox_faction: RobloxFactionLink | null;
}
export interface RobloxFactionLink {
  faction_id: string;
  name: string;
  linked_at: string;
}
export interface JoinRequest {
  id: string;
  status: "PENDING" | "ACCEPTED" | "REJECTED" | "CANCELLED";
  message: string;
  created_at: string;
  reviewed_at: string | null;
  faction: FactionSummary;
  player: Pick<
    Player,
    "id" | "username" | "display_name" | "avatar_url" | "rating" | "region"
  >;
}
export interface MyFactions {
  owned: FactionSummary[];
  membership: FactionSummary | null;
  requests: JoinRequest[];
}
export interface FactionManagement {
  faction: FactionDetail;
  requests: JoinRequest[];
  recent_requests: JoinRequest[];
}
