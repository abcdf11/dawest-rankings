import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { KeyRound, LoaderCircle, ShieldCheck, UserRound } from "lucide-react";
import type { FormEvent } from "react";
import { Brand } from "./Shared";
import { request } from "../lib/api";
import { useSession } from "../hooks/useSession";
import type { Session } from "../hooks/useSession";

export default function AuthPage({
  signup = false,
  developer = false,
}: {
  signup?: boolean;
  developer?: boolean;
}) {
  const session = useSession();
  const [form, setForm] = useState({
    username: "",
    display_name: "",
    region: "NA",
    password: "",
    password_confirm: "",
  });
  const next = new URLSearchParams(window.location.search).get("next");
  const destination = developer
    ? "/dev"
    : next &&
        next.startsWith("/") &&
        !next.startsWith("//") &&
        !next.includes("\\")
      ? next
      : "/";
  const mutation = useMutation({
    mutationFn: () =>
      request<Session>(
        signup
          ? "/auth/signup/"
          : developer
            ? "/auth/dev-login/"
            : "/auth/login/",
        {
          method: "POST",
          body: JSON.stringify(
            signup
              ? form
              : { username: form.username, password: form.password },
          ),
        },
      ),
    onSuccess: () => window.location.assign(destination),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }
  const update = (key: keyof typeof form, value: string) => {
    setForm((old) => ({ ...old, [key]: value }));
    mutation.reset();
  };
  return (
    <div className="registration-site auth-site">
      <header className="registration-header">
        <a href="/" aria-label="DaWest rankings home">
          <Brand />
        </a>
        <span className="registration-header-label">
          {developer ? "DEVELOPER ACCESS" : "PLAYER ACCOUNTS"}
        </span>
        <a className="registration-back" href="/">
          Power rankings
        </a>
      </header>
      <main className="auth-layout">
        <div className="auth-intro">
          <span className="registration-eyebrow">
            {developer ? "COMPETITION CONTROL" : "YOUR REPUTATION STARTS HERE"}
          </span>
          <h1>
            {developer
              ? "BEHIND THE FRONTIER."
              : signup
                ? "MAKE IT OFFICIAL."
                : "WELCOME BACK."}
          </h1>
          <p>
            {developer
              ? "Sign in with your developer account to review applications and manage registered competitors."
              : signup
                ? "Create a player account to appear on the leaderboard, build your record, and register your team."
                : "Sign in to your registered player account and get back to the frontier."}
          </p>
          <div className="auth-note">
            <ShieldCheck size={18} />
            <span>
              {developer
                ? "Developer accounts are provisioned by the site owner."
                : "Your account and competitive history are stored in the DaWest database."}
            </span>
          </div>
        </div>
        <section className="registration-card auth-card">
          <form className="registration-form" onSubmit={submit}>
            <div className="registration-form-heading">
              <span className="registration-form-icon">
                {developer ? (
                  <ShieldCheck size={23} />
                ) : signup ? (
                  <UserRound size={23} />
                ) : (
                  <KeyRound size={23} />
                )}
              </span>
              <div>
                <h2>
                  {developer
                    ? "DEVELOPER LOGIN"
                    : signup
                      ? "CREATE PLAYER ACCOUNT"
                      : "PLAYER LOGIN"}
                </h2>
                <p>
                  {developer
                    ? "Authorized staff only."
                    : signup
                      ? "Register once. Every result counts."
                      : "Your place on the frontier is waiting."}
                </p>
              </div>
            </div>
            {session.data?.authenticated && (
              <div className="auth-session-note">
                Signed in as {session.data.user?.username}.{" "}
                <a href={session.data.user?.is_developer ? "/dev" : "/"}>
                  Continue
                </a>
              </div>
            )}
            <fieldset disabled={mutation.isPending || session.isPending}>
              <label className="registration-field">
                Username
                <input
                  required
                  autoComplete="username"
                  maxLength={signup ? 30 : 150}
                  minLength={signup ? 3 : 1}
                  pattern={signup ? "[a-zA-Z0-9_]{3,30}" : undefined}
                  value={form.username}
                  onChange={(e) => update("username", e.target.value)}
                  placeholder="Your username"
                />
              </label>
              {signup && (
                <>
                  <label className="registration-field">
                    Display name
                    <input
                      required
                      minLength={2}
                      maxLength={64}
                      value={form.display_name}
                      onChange={(e) => update("display_name", e.target.value)}
                      placeholder="Your name on the ladder"
                    />
                  </label>
                  <label className="registration-field">
                    Region
                    <select
                      value={form.region}
                      onChange={(e) => update("region", e.target.value)}
                    >
                      <option value="NA">North America</option>
                      <option value="EU">Europe</option>
                      <option value="ASIA">Asia</option>
                      <option value="SA">South America</option>
                      <option value="OCE">Oceania</option>
                    </select>
                  </label>
                </>
              )}
              <label className="registration-field">
                Password
                <input
                  type="password"
                  required
                  minLength={signup ? 8 : 1}
                  maxLength={128}
                  autoComplete={signup ? "new-password" : "current-password"}
                  value={form.password}
                  onChange={(e) => update("password", e.target.value)}
                  placeholder={
                    signup ? "At least 8 characters" : "Your password"
                  }
                />
              </label>
              {signup && (
                <label className="registration-field">
                  Confirm password
                  <input
                    type="password"
                    required
                    minLength={8}
                    maxLength={128}
                    autoComplete="new-password"
                    value={form.password_confirm}
                    onChange={(e) => update("password_confirm", e.target.value)}
                    placeholder="Repeat your password"
                  />
                </label>
              )}
            </fieldset>
            {(mutation.isError || session.isError) && (
              <p className="registration-error" role="alert">
                {mutation.error?.message ||
                  "Could not connect to the account service. Please try again."}
              </p>
            )}
            <button
              className="button primary registration-submit"
              type="submit"
              disabled={
                mutation.isPending || session.isPending || session.isError
              }
            >
              {mutation.isPending ? (
                <LoaderCircle size={17} className="registration-spin" />
              ) : (
                <KeyRound size={16} />
              )}{" "}
              {mutation.isPending
                ? "Signing in…"
                : signup
                  ? "Create player account"
                  : developer
                    ? "Sign in to developer console"
                    : "Log in"}
            </button>
            <div className="auth-links">
              {!developer && (
                <a
                  href={`${signup ? "/login" : "/signup"}${next ? `?next=${encodeURIComponent(destination)}` : ""}`}
                >
                  {signup
                    ? "Already registered? Log in"
                    : "New to DaWest? Create an account"}
                </a>
              )}
              <a href={developer ? "/login" : "/dev/login"}>
                {developer ? "Player login" : "Developer login"}
              </a>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}
