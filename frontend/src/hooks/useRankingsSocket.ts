import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import type { LiveMatch, RankingKind } from "../types/rankings";
export function useRankingsSocket(
  enabled: boolean,
  kind: RankingKind = "players",
) {
  const query = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [matches, setMatches] = useState<LiveMatch[]>([]);
  useEffect(() => {
    setMatches([]);
    if (!enabled) {
      setConnected(false);
      return;
    }
    const socket = io(
      import.meta.env.VITE_SOCKET_URL || window.location.origin,
      { transports: ["websocket", "polling"], reconnectionDelayMax: 8000 },
    );
    socket.on("connect", () => {
      void query.invalidateQueries({ queryKey: ["rankings"] });
    });
    socket.on("GATEWAY_STATUS", ({ live }: { live: boolean }) =>
      setConnected(live),
    );
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => setConnected(false));
    socket.on("RANKINGS_REFRESH", () => {
      void query.invalidateQueries({ queryKey: ["rankings"] });
      void query.invalidateQueries({ queryKey: ["player"] });
      void query.invalidateQueries({ queryKey: ["team"] });
    });
    socket.on("MATCH_LIVE", (event: LiveMatch) => {
      if ((event.kind ?? "players") !== kind) return;
      setMatches((current) =>
        [event, ...current.filter((m) => m.match_id !== event.match_id)].slice(
          0,
          5,
        ),
      );
    });
    return () => {
      socket.disconnect();
    };
  }, [enabled, kind, query]);
  return { connected, matches };
}
