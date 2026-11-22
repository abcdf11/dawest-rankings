import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut, Shield, UserRound, UsersRound } from "lucide-react";
import { request } from "../lib/api";
import { useSession } from "../hooks/useSession";
import { accountDestination } from "../lib/profile";
import { EventNotifications } from "./EventNotifications";
import { UsernameSettings } from "./UsernameSettings";
export function AccountMenu() {
  const session = useSession();
  const client = useQueryClient();
  const logout = useMutation({
    mutationFn: () => request("/auth/logout/", { method: "POST", body: "{}" }),
    onSuccess: () => {
      client.clear();
      window.location.assign("/");
    },
  });
  if (session.isPending)
    return <span className="account-pending">CONNECTING</span>;
  if (!session.data?.authenticated)
    return (
      <div className="account-menu">
        <a href="/login">Log in</a>
        <a className="account-signup" href="/signup">
          Sign up
        </a>
      </div>
    );
  return (
    <div className="account-menu">
      <a
        className="account-username"
        href={accountDestination(session.data?.user)}
        aria-label={
          session.data?.user?.player
            ? "View your profile"
            : "Developer console home"
        }
      >
        <UserRound size={14} />
        <span>{session.data.user?.username}</span>
      </a>
      <UsernameSettings compact />
      <EventNotifications userId={session.data.user!.id} />
      {session.data.user?.is_developer && (
        <a href="/dev" aria-label="Developer console">
          <Shield size={15} />
        </a>
      )}
      <a href="/faction" aria-label="My faction" title="My faction">
        <UsersRound size={16} />
      </a>
      <button
        className="icon-button"
        aria-label="Log out"
        disabled={logout.isPending}
        onClick={() => logout.mutate()}
      >
        <LogOut size={15} />
      </button>
      {logout.isError && <span role="alert">Logout failed</span>}
    </div>
  );
}
