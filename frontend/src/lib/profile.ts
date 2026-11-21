import type { SessionUser } from "../hooks/useSession";

export const profileUrl = (username: string) =>
  `/players/${encodeURIComponent(username)}`;
export const factionUrl = (username: string) =>
  `/factions/${encodeURIComponent(username)}`;

export function accountDestination(user: SessionUser | null | undefined) {
  if (user?.player) return profileUrl(user.player.username);
  return user?.is_developer ? "/dev" : "/";
}
