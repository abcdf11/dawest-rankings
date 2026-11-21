import { useQuery } from "@tanstack/react-query";
import { request } from "../lib/api";
export interface SessionUser {
  id: number;
  username: string;
  is_developer: boolean;
  player: {
    id: number;
    username: string;
    display_name: string;
    region: string;
    rating: number;
    rank: number;
    is_active: boolean;
    is_restricted?: boolean;
    restriction_reason?: string;
  } | null;
}
export interface Session {
  authenticated: boolean;
  user: SessionUser | null;
  csrf_token: string;
}
export function useSession() {
  return useQuery({
    queryKey: ["session"],
    queryFn: () => request<Session>("/auth/session/"),
    staleTime: 30_000,
    retry: false,
  });
}
