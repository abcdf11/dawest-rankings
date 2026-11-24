import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Copy, Gamepad2, LoaderCircle, Unlink } from "lucide-react";
import { request } from "../lib/api";
import type { SessionUser } from "../hooks/useSession";

interface LinkCode {
  code: string;
  expires_at: string;
}
interface LinkStatus {
  available: boolean;
  roblox: NonNullable<SessionUser["player"]>["roblox"];
  expires_at: string | null;
}

const endpoint = "/auth/roblox/link/";

/** Own profile: verify the account by entering a short-lived code inside DaWest. */
export function RobloxLinkCard({ user }: { user: SessionUser }) {
  const client = useQueryClient();
  const key = ["roblox-link", user.id];
  const [code, setCode] = useState<LinkCode | null>(null);
  const [now, setNow] = useState(Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  const status = useQuery({
    queryKey: key,
    queryFn: () => request<LinkStatus>(endpoint),
    refetchInterval: (query) =>
      query.state.data?.expires_at && !query.state.data.roblox ? 3000 : false,
    retry: false,
  });
  const roblox = status.data ? status.data.roblox : user.player?.roblox;
  const available = status.data?.available ?? user.roblox_link_available;
  const seconds = code ? Math.max(0, Math.ceil((Date.parse(code.expires_at) - now) / 1000)) : 0;
  const refreshProfile = () => {
    void client.invalidateQueries({ queryKey: ["session"] });
    void client.invalidateQueries({ queryKey: ["player-profile"] });
  };

  useEffect(() => {
    if (!code) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [code]);

  useEffect(() => {
    if ((roblox?.user_id ?? null) !== (user.player?.roblox?.user_id ?? null)) {
      void client.invalidateQueries({ queryKey: ["session"] });
      void client.invalidateQueries({ queryKey: ["player-profile"] });
    }
    if (roblox) setCode(null);
  }, [roblox?.user_id, user.player?.roblox?.user_id, client]);

  const getCode = useMutation({
    mutationFn: () => request<LinkCode>(endpoint, { method: "POST" }),
    onMutate: () => setNotice(null),
    onSuccess: (next) => {
      setNow(Date.now());
      setCode(next);
      client.setQueryData<LinkStatus>(key, { available: true, roblox: null, expires_at: next.expires_at });
    },
  });
  const cancel = useMutation({
    mutationFn: () => request<LinkStatus>(endpoint, { method: "DELETE" }),
    onMutate: () => setNotice(null),
    onSuccess: (next) => {
      setCode(null);
      client.setQueryData(key, next);
    },
  });
  const unlink = useMutation({
    mutationFn: () => request("/auth/roblox/unlink/", { method: "POST" }),
    onMutate: () => setNotice(null),
    onSuccess: () => {
      setCode(null);
      setNotice("Roblox account unlinked.");
      client.setQueryData<LinkStatus>(key, { available: available !== false, roblox: null, expires_at: null });
      refreshProfile();
    },
  });
  const busy = getCode.isPending || cancel.isPending || unlink.isPending;
  const error = getCode.error ?? cancel.error ?? unlink.error ?? status.error;

  async function copyCode() {
    if (!code || !seconds) return;
    try {
      await navigator.clipboard.writeText(code.code);
      setNotice("Link code copied.");
    } catch {
      setNotice("Select the code and copy it to your clipboard.");
    }
  }

  return (
    <section className="profile-side-card profile-roblox">
      <div className="profile-section-title">
        <h2>Roblox account</h2>
        <Gamepad2 size={17} aria-hidden />
      </div>
      {notice && <p className="profile-roblox-notice" role="status">{notice}</p>}
      {roblox ? (
        <>
          <p className="profile-roblox-linked">
            <BadgeCheck size={16} aria-hidden /> Linked to <strong>{roblox.display_name || roblox.username}</strong>
            <small>@{roblox.username}</small>
          </p>
          <p className="profile-roblox-help">Your DaWest rating syncs to the game automatically.</p>
          <button type="button" className="profile-side-link profile-roblox-unlink" onClick={() => unlink.mutate()} disabled={busy}>
            {unlink.isPending ? <LoaderCircle size={15} className="profile-spinner" /> : <Unlink size={15} />} Unlink Roblox
          </button>
        </>
      ) : (
        <>
          <p className="profile-roblox-help">Get a code, then join DaWest on the Roblox account you want to link.</p>
          {available === false ? (
            <p className="profile-roblox-notice is-error">Roblox account linking is temporarily unavailable.</p>
          ) : (
            <>
              {code && (
                <div className="profile-roblox-code">
                  <span className="eyebrow">YOUR LINK CODE</span>
                  <code aria-label="Roblox link code">{code.code}</code>
                  <p role="timer" aria-label="Code expires in">
                    {seconds ? `Expires in ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}` : "Code expired. Get a new link code."}
                  </p>
                  <button type="button" className="profile-side-link profile-roblox-action" onClick={copyCode} disabled={!seconds || busy}>
                    <Copy size={15} aria-hidden /> Copy code
                  </button>
                </div>
              )}
              <p className="profile-roblox-help">
                In the game, open <strong>Settings → Ranked</strong>, enter your code and press <strong>Link account</strong>.
                This page updates when verification succeeds. Keep your code private.
              </p>
              <div className="profile-roblox-actions">
                <button type="button" className="profile-side-link profile-roblox-action" onClick={() => getCode.mutate()} disabled={busy || status.isPending}>
                  {getCode.isPending ? <LoaderCircle size={15} className="profile-spinner" /> : <Gamepad2 size={15} />}
                  {code || status.data?.expires_at ? "New link code" : "Get link code"}
                </button>
                {(code || status.data?.expires_at) && (
                  <button type="button" className="profile-side-link profile-roblox-action" onClick={() => cancel.mutate()} disabled={busy}>
                    Cancel linking
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}
      {error && <p className="profile-roblox-notice is-error" role="alert">{error.message}</p>}
    </section>
  );
}
