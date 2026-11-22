import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Settings2 } from "lucide-react";
import { useSession } from "../hooks/useSession";
import type { Session, SessionUser } from "../hooks/useSession";
import { request } from "../lib/api";
import { profileUrl } from "../lib/profile";
import { Modal } from "./Modal";

export function UsernameSettings({ compact = false }: { compact?: boolean }) {
  const session = useSession();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const user = session.data?.user;
  if (!user) return null;
  return (
    <>
      <button
        type="button"
        className={compact ? "icon-button" : "profile-copy profile-customize"}
        aria-label={compact ? "Account settings" : undefined}
        title={compact ? "Account settings" : undefined}
        onClick={() => setOpen(true)}
      >
        {compact ? (
          <Settings2 size={17} />
        ) : (
          <>
            <Pencil size={15} /> Change username
          </>
        )}
      </button>
      {open &&
        createPortal(
          <UsernameEditor user={user} onClose={close} />,
          document.body,
        )}
    </>
  );
}

function UsernameEditor({
  user,
  onClose,
}: {
  user: SessionUser;
  onClose: () => void;
}) {
  const [username, setUsername] = useState(user.username);
  const client = useQueryClient();
  const normalized = username.trim().toLowerCase();
  const changed = normalized !== user.username;
  const save = useMutation({
    mutationFn: () =>
      request<Session & { profile_url: string | null }>("/auth/username/", {
        method: "POST",
        body: JSON.stringify({ username: normalized }),
      }),
    onSuccess: (result) => {
      const onOwnProfile =
        user.player &&
        window.location.pathname.replace(/\/$/, "") ===
          profileUrl(user.player.username);
      const destination =
        onOwnProfile && result.profile_url
          ? result.profile_url + window.location.hash
          : window.location.pathname +
            window.location.search +
            window.location.hash;
      client.clear();
      window.location.assign(destination);
    },
  });
  return (
    <Modal
      title="CHANGE USERNAME"
      onClose={onClose}
      dismissible={!save.isPending}
    >
      <form
        className="registration-form account-username-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed) save.mutate();
        }}
      >
        <h2>Change username</h2>
        <p>
          This updates your sign-in name and profile link. Existing profile
          links will continue to work.
        </p>
        <fieldset disabled={save.isPending}>
          <p className="account-current-username">
            Current username <strong>@{user.username}</strong>
          </p>
          <label className="registration-field">
            New username
            <input
              required
              minLength={3}
              maxLength={30}
              pattern="[A-Za-z0-9_]{3,30}"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              aria-describedby="username-rules"
              onChange={(event) => {
                setUsername(event.target.value);
                save.reset();
              }}
            />
          </label>
          <p id="username-rules" className="registration-help">
            Use 3–30 letters, numbers, or underscores. Usernames are saved in
            lowercase.
          </p>
          {user.player && (
            <p className="account-profile-preview">
              Profile link: <span>{profileUrl(normalized)}</span>
            </p>
          )}
        </fieldset>
        {save.error && (
          <p className="registration-error" role="alert">
            {save.error.message}
          </p>
        )}
        <div className="account-username-actions">
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={save.isPending}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={save.isPending || !changed}
          >
            {save.isPending ? "Saving…" : "Save username"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
