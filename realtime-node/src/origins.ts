import type { IncomingHttpHeaders } from "node:http";

export function allowsOrigin(
  request: { headers: IncomingHttpHeaders },
  allowed: string[],
  sameOrigin: boolean,
): boolean {
  const origin = request.headers.origin;
  if (!origin || allowed.includes(origin)) return true;
  if (!sameOrigin) return false;
  // This mode is for the private gateway behind our trusted Nginx proxy.
  // Nginx replaces Host and X-Forwarded-Proto with the public request's values.
  const scheme = request.headers["x-forwarded-proto"];
  if (scheme !== "http" && scheme !== "https") return false;
  return origin === `${scheme}://${request.headers.host}`;
}
