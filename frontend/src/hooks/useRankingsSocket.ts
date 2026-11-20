import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io } from "socket.io-client";
import type { LiveMatch } from "../types/rankings";
export function useRankingsSocket(enabled: boolean) {
  const query = useQueryClient();
  const [connected, setConnected] = useState(false);
  const [matches, setMatches] = useState<LiveMatch[]>([]);
  useEffect(() => {
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
    });
    socket.on("MATCH_LIVE", (event: LiveMatch) =>
      setMatches((current) =>
        [event, ...current.filter((m) => m.match_id !== event.match_id)].slice(
          0,
          5,
        ),
      ),
    );
    return () => {
      socket.disconnect();
    };
  }, [enabled, query]);
  return { connected, matches };
}
