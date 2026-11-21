import type {
  Ladder,
  PlayerDetail,
  TeamDetail,
  TeamLadder,
  RankingKind,
  RankingEntry,
} from "../types/rankings";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
const base = (import.meta.env.VITE_API_URL ?? "/api/v1").replace(/\/$/, "");
function csrfCookie() {
  return typeof document === "undefined"
    ? undefined
    : document.cookie.match(/(?:^|; )csrftoken=([^;]+)/)?.[1];
}
export async function request<T>(
  path: string,
  options?: RequestInit,
  timeoutMs = 7000,
): Promise<T> {
  const unsafe =
    options?.method &&
    !["GET", "HEAD", "OPTIONS"].includes(options.method.toUpperCase());
  if (unsafe && !csrfCookie()) {
    const bootstrap = await fetch(`${base}/auth/session/`, {
      credentials: "include",
      signal: AbortSignal.timeout(7000),
    });
    if (!bootstrap.ok)
      throw new Error(
        "Could not initialize a secure session. Please reload and try again.",
      );
  }
  const response = await fetch(`${base}${path}`, {
    ...options,
    credentials: "include",
    signal: options?.signal ?? AbortSignal.timeout(timeoutMs),
    headers: {
      ...(options?.body instanceof FormData
        ? {}
        : { "Content-Type": "application/json" }),
      ...(csrfCookie()
        ? { "X-CSRFToken": decodeURIComponent(csrfCookie()!) }
        : {}),
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const firstError = (value: unknown): string | undefined => {
      if (typeof value === "string") return value;
      if (Array.isArray(value)) return value.map(firstError).find(Boolean);
      if (value && typeof value === "object")
        return Object.values(value).map(firstError).find(Boolean);
      return undefined;
    };
    throw new ApiError(
      firstError(body) ?? "The service is unavailable. Please try again.",
      response.status,
    );
  }
  return response.json() as Promise<T>;
}
export async function getLadder(
  kind: RankingKind = "players",
): Promise<Ladder<RankingEntry>> {
  if (kind === "teams") {
    const ladder = await request<TeamLadder>("/teams/rankings/");
    return { ...ladder, players: ladder.teams };
  }
  return request<Ladder>("/rankings/");
}
export async function getPlayer(
  player: RankingEntry,
  _source: Ladder["source"],
  kind: RankingKind = "players",
): Promise<PlayerDetail | TeamDetail> {
  return request(`/${kind}/${encodeURIComponent(player.username)}/`);
}
export function getPlayerProfile(username: string) {
  return request<PlayerDetail>(`/players/${encodeURIComponent(username)}/`);
}
