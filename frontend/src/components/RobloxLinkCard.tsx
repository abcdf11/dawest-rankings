import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, Gamepad2, LoaderCircle, Unlink } from "lucide-react";
import { request } from "../lib/api";
import type { SessionUser } from "../hooks/useSession";

// what /api/v1/auth/roblox/callback/ sends back in ?roblox=
const outcomes: Record<string, { tone: "ok" | "error"; text: string }> = {
  linked: { tone: "ok", text: "Roblox account linked. Your rating now shows in-game." },
  cancelled: { tone: "error", text: "Roblox login was cancelled." },
  expired: { tone: "error", text: "That Roblox login expired. Please try again." },
  failed: { tone: "error", text: "Roblox didn't respond. Please try again in a moment." },
  taken: { tone: "error", text: "That Roblox account is already linked to another DaWest player." },
  unavailable: { tone: "error", text: "Roblox login isn't set up on this site yet." },
};

/** Own profile only: Log in with Roblox to link the account the game reads your rating for. */
export function RobloxLinkCard({ user }: { user: SessionUser }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const roblox = user.player?.roblox ?? null;

  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get("roblox");
    if (!outcome) return;
    setNotice(outcomes[outcome] ?? null);
    url.searchParams.delete("roblox");
    window.history.replaceState(null, "", url);
    void queryClient.invalidateQueries({ queryKey: ["session"] });
  }, [queryClient]);

  async function unlink() {
    setBusy(true);
    try {
      await request("/auth/roblox/unlink/", { method: "POST" });
      setNotice({ tone: "ok", text: "Roblox account unlinked." });
      await queryClient.invalidateQueries({ queryKey: ["session"] });
    } catch {
      setNotice({ tone: "error", text: "Couldn't unlink right now. Please try again." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="profile-side-card profile-roblox">
      <div className="profile-section-title">
        <h2>Roblox account</h2>
        <Gamepad2 size={17} />
      </div>
      {notice && (
        <p className={`profile-roblox-notice is-${notice.tone}`} role="status">
          {notice.text}
        </p>
      )}
      {roblox ? (
        <>
          <p className="profile-roblox-linked">
            <BadgeCheck size={16} /> Linked to <strong>{roblox.display_name || roblox.username}</strong>
            <small>@{roblox.username}</small>
          </p>
          <p className="profile-roblox-help">Your DaWest rating syncs to the game automatically when you join.</p>
          <button type="button" className="profile-side-link profile-roblox-unlink" onClick={unlink} disabled={busy}>
            {busy ? <LoaderCircle size={15} className="profile-spinner" /> : <Unlink size={15} />} Unlink Roblox
          </button>
        </>
      ) : (
        <>
          <p className="profile-roblox-help">Link your Roblox account so your rating shows up in the DaWest game.</p>
          {user.roblox_login_available === false ? (
            <p className="profile-roblox-notice is-error">Roblox login isn't set up on this site yet.</p>
          ) : (
            // a full page navigation: the server redirects to Roblox's own login and back
            <a href="/api/v1/auth/roblox/start/" className="profile-side-link profile-roblox-login">
              <Gamepad2 size={15} /> Log in with Roblox
            </a>
          )}
        </>
      )}
    </section>
  );
}
