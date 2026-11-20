import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LogOut, Shield, UserRound } from "lucide-react";
import { request } from "../lib/api";
import { useSession } from "../hooks/useSession";
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
          Join the ladder
        </a>
      </div>
    );
  return (
    <div className="account-menu">
      <span className="account-username">
        <UserRound size={14} />
        {session.data.user?.username}
      </span>
      {session.data.user?.is_developer && (
        <a href="/dev" aria-label="Developer console">
          <Shield size={15} />
        </a>
      )}
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
