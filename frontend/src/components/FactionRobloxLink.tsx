import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Gamepad2, LoaderCircle, Unlink } from "lucide-react";
import { request } from "../lib/api";
import type { RobloxFactionLink } from "../types/factions";

interface LinkCode {
  code: string;
  expires_at: string;
}

/** Leader dashboard: link this site faction to its in-game faction with a one-time code. */
export function FactionRobloxLink({
  username,
  linked,
}: {
  username: string;
  linked: RobloxFactionLink | null;
}) {
  const client = useQueryClient();
  const endpoint = `/factions/${encodeURIComponent(username)}/roblox-link/`;
  const [code, setCode] = useState<LinkCode | null>(null);
  const refresh = () => {
    for (const key of ["faction", "factions", "my-factions"])
      void client.invalidateQueries({ queryKey: [key] });
  };
  const getCode = useMutation({
    mutationFn: () => request<LinkCode>(endpoint, { method: "POST" }),
    onSuccess: setCode,
  });
  const unlink = useMutation({
    mutationFn: () => request(endpoint, { method: "DELETE" }),
    onSuccess: () => {
      setCode(null);
      refresh();
    },
  });
  const error = getCode.error ?? unlink.error;

  return (
    <div className="faction-roblox-link">
      {linked ? (
        <p>
          <Gamepad2 size={16} aria-hidden /> Linked to the in-game faction{" "}
          <strong>{linked.name}</strong>. King of the Hill rounds between
          linked factions count for this faction's rating, and the game shows
          it in the faction menu.
        </p>
      ) : (
        <p className="muted">
          Not linked. Link your in-game faction so King of the Hill rounds
          count for this faction and its rating shows in the game. You must be
          the in-game faction's leader, playing on the Roblox account linked to
          your profile.
        </p>
      )}
      {code && (
        <div className="faction-roblox-code" aria-live="polite">
          <span className="eyebrow">LINK CODE · VALID 10 MINUTES</span>
          <code>{code.code}</code>
          <p className="muted">
            In the game, press <kbd>U</kbd>, open the <strong>Settings</strong>{" "}
            tab and enter this code under <strong>DaWest Rankings link</strong>
            . Then refresh this page.
          </p>
        </div>
      )}
      <div className="faction-roblox-actions">
        <button
          type="button"
          className="button primary"
          disabled={getCode.isPending}
          onClick={() => getCode.mutate()}
        >
          {getCode.isPending && <LoaderCircle className="profile-spinner" size={16} aria-hidden />}
          {linked ? "Get a code to re-link" : code ? "New code" : "Get link code"}
        </button>
        {linked && (
          <button
            type="button"
            className="button secondary"
            disabled={unlink.isPending}
            onClick={() => unlink.mutate()}
          >
            <Unlink size={16} aria-hidden /> Unlink
          </button>
        )}
      </div>
      {error && (
        <p className="registration-error faction-feedback" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}
