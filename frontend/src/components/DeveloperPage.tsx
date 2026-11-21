import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  ClipboardList,
  Clock3,
  LoaderCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  UsersRound,
  X,
} from "lucide-react";
import type { FormEvent } from "react";
import { Brand } from "./Shared";
import { AccountMenu } from "./AccountMenu";
import { Modal } from "./Modal";
import { useSession } from "../hooks/useSession";
import { request } from "../lib/api";
import { AdminTerminal, EloControls } from "./AdminTools";
import { EventManager } from "./EventManager";
import "../developer.css";

interface DevPlayer {
  id: number;
  username: string;
  display_name: string;
  region: string;
  rating: number;
  rank: number;
  is_active: boolean;
  is_restricted?: boolean;
}
interface DevTeam {
  id: number;
  username: string;
  display_name: string;
  tag: string;
  region: string;
  rating: number;
  is_active: boolean;
  roster: { id: number; username: string; display_name: string }[];
}
interface Application {
  id: string;
  reference: string;
  team_name: string;
  tag: string;
  region: string;
  status: string;
  captain_username: string;
  contact_discord: string;
  description: string;
  review_note: string;
  created_at: string;
  members: { username: string; display_name: string; is_captain: boolean }[];
}
interface Dashboard {
  stats: { players: number; teams: number; pending: number };
  players: DevPlayer[];
  teams: DevTeam[];
  registrations: Application[];
  audit: {
    id: string;
    actor: string;
    action: string;
    target_type: string;
    target_id: string;
    created_at: string;
  }[];
}
type Tab =
  | "applications"
  | "players"
  | "teams"
  | "activity"
  | "elo"
  | "terminal"
  | "events";

export default function DeveloperPage() {
  const session = useSession();
  const client = useQueryClient();
  const [tab, setTab] = useState<Tab>(
    window.location.hash === "#events" ? "events" : "applications",
  );
  const [form, setForm] = useState<"player" | "team" | null>(null);
  const [filter, setFilter] = useState("PENDING");
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const dashboard = useQuery({
    queryKey: ["developer"],
    queryFn: () => request<Dashboard>("/dev/dashboard/"),
    enabled: Boolean(session.data?.user?.is_developer),
    retry: false,
  });
  const action = useMutation({
    mutationFn: ({
      path,
      method = "POST",
      body,
      message,
    }: {
      path: string;
      method?: string;
      body?: unknown;
      message: string;
    }) =>
      request(path, { method, body: JSON.stringify(body ?? {}) }).then(
        () => message,
      ),
    onSuccess: (message) => {
      setNotice(message);
      void client.invalidateQueries({ queryKey: ["developer"] });
      void client.invalidateQueries({ queryKey: ["rankings"] });
    },
  });
  const data = dashboard.data;
  const refreshAdminData = () => {
    for (const key of [
      "developer",
      "rankings",
      "player-profile",
      "player",
      "team",
      "faction",
      "factions",
      "my-factions",
      "session",
    ])
      void client.invalidateQueries({ queryKey: [key] });
  };
  const matches = (value: string) =>
    value.toLowerCase().includes(search.toLowerCase());
  return (
    <div className="registration-site dev-site">
      <header className="registration-header">
        <a href="/" aria-label="DaWest rankings home">
          <Brand />
        </a>
        <span className="registration-header-label">DEVELOPER CONSOLE</span>
        <AccountMenu />
        <a className="registration-back" href="/">
          View rankings
        </a>
      </header>
      {session.isPending ? (
        <div className="auth-gate">
          <LoaderCircle className="registration-spin" />
          <h2>CHECKING DEVELOPER ACCESS.</h2>
        </div>
      ) : !session.data?.user?.is_developer ? (
        <div className="auth-gate dev-access-gate">
          <ShieldCheck size={38} />
          <h2>DEVELOPER ACCESS REQUIRED.</h2>
          <p>This console is available to authorized developer accounts.</p>
          <a className="button primary" href="/dev/login">
            Developer login
          </a>
        </div>
      ) : (
        <main className="dev-main">
          <div className="dev-heading">
            <div>
              <span className="registration-eyebrow">
                AUTHORIZED STAFF / COMPETITION CONTROL
              </span>
              <h1>DEVELOPER CONSOLE</h1>
              <p>Review applications. Manage registered players and teams.</p>
            </div>
            <button
              className="button secondary"
              onClick={() => void dashboard.refetch()}
              disabled={dashboard.isFetching}
            >
              <RefreshCw
                size={15}
                className={dashboard.isFetching ? "registration-spin" : ""}
              />
              Refresh
            </button>
          </div>
          <div className="dev-stats">
            <div>
              <UsersRound size={20} />
              <span>
                <b>{data?.stats.players ?? "—"}</b>REGISTERED PLAYERS
              </span>
            </div>
            <div>
              <ShieldCheck size={20} />
              <span>
                <b>{data?.stats.teams ?? "—"}</b>REGISTERED TEAMS
              </span>
            </div>
            <div>
              <Clock3 size={20} />
              <span>
                <b>{data?.stats.pending ?? "—"}</b>AWAITING REVIEW
              </span>
            </div>
          </div>
          <div className="dev-toolbar">
            <nav aria-label="Developer sections">
              {(
                [
                  ["applications", "Applications"],
                  ["players", "Players"],
                  ["teams", "Teams"],
                  ["events", "Event maker"],
                  ["elo", "Elo controls"],
                  ["terminal", "Terminal"],
                  ["activity", "Activity"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  className={tab === key ? "active" : ""}
                  onClick={() => {
                    setTab(key);
                    setSearch("");
                  }}
                >
                  {label}
                </button>
              ))}
            </nav>
            {(tab === "players" || tab === "teams") && (
              <button
                className="button primary"
                onClick={() => setForm(tab === "players" ? "player" : "team")}
              >
                <Plus size={15} />
                Add {tab === "players" ? "player" : "team"}
              </button>
            )}
          </div>
          {(dashboard.isError || action.isError) && (
            <p className="registration-error" role="alert">
              {action.error?.message || dashboard.error?.message}
            </p>
          )}
          {notice && (
            <p className="dev-notice" role="status">
              <Check size={15} />
              {notice}
            </p>
          )}
          {!data && !dashboard.isError ? (
            <div className="auth-gate">
              <LoaderCircle className="registration-spin" />
              <p>Loading registered competitors…</p>
            </div>
          ) : (
            data && (
              <>
                {tab === "applications" && (
                  <>
                    <div className="dev-filter">
                      <span>
                        {data.registrations.length} recent applications
                      </span>
                      <select
                        aria-label="Application status"
                        value={filter}
                        onChange={(e) => setFilter(e.target.value)}
                      >
                        <option value="PENDING">Pending review</option>
                        <option value="APPROVED">Approved</option>
                        <option value="REJECTED">Rejected</option>
                        <option value="ALL">All applications</option>
                      </select>
                    </div>
                    <div className="dev-applications">
                      {data.registrations
                        .filter((r) => filter === "ALL" || r.status === filter)
                        .map((r) => (
                          <article className="dev-application" key={r.id}>
                            <div className="dev-application-heading">
                              <div>
                                <span className="registration-eyebrow">
                                  {r.reference} / {r.region}
                                </span>
                                <h2>
                                  {r.team_name}
                                  <small>{r.tag}</small>
                                </h2>
                              </div>
                              <span className="dev-status">{r.status}</span>
                            </div>
                            {r.description && (
                              <p className="dev-description">{r.description}</p>
                            )}
                            <p className="dev-captain">
                              Captain: <b>{r.captain_username}</b>
                              {r.contact_discord && (
                                <> · Discord: {r.contact_discord}</>
                              )}
                            </p>
                            <div className="dev-roster">
                              {r.members.map((m) => (
                                <span key={m.username}>
                                  {m.is_captain && <ShieldCheck size={12} />}@
                                  {m.username}
                                </span>
                              ))}
                            </div>
                            {r.status === "PENDING" ? (
                              <div className="dev-review">
                                <label className="registration-field">
                                  Public review note
                                  <input
                                    maxLength={500}
                                    value={notes[r.id] ?? r.review_note}
                                    onChange={(e) =>
                                      setNotes((old) => ({
                                        ...old,
                                        [r.id]: e.target.value,
                                      }))
                                    }
                                    placeholder="Optional message to the captain"
                                  />
                                </label>
                                <div>
                                  <button
                                    className="button primary"
                                    disabled={action.isPending}
                                    onClick={() =>
                                      action.mutate({
                                        path: `/dev/registrations/${r.id}/review/`,
                                        body: {
                                          decision: "APPROVED",
                                          note: notes[r.id] ?? r.review_note,
                                        },
                                        message: `${r.team_name} approved and added to the leaderboard.`,
                                      })
                                    }
                                  >
                                    <Check size={15} />
                                    Approve
                                  </button>
                                  <button
                                    className="button secondary"
                                    disabled={action.isPending}
                                    onClick={() =>
                                      action.mutate({
                                        path: `/dev/registrations/${r.id}/review/`,
                                        body: {
                                          decision: "REJECTED",
                                          note: notes[r.id] ?? r.review_note,
                                        },
                                        message: `${r.team_name} registration rejected.`,
                                      })
                                    }
                                  >
                                    <X size={15} />
                                    Reject
                                  </button>
                                </div>
                              </div>
                            ) : (
                              r.review_note && (
                                <p className="dev-review-note">
                                  {r.review_note}
                                </p>
                              )
                            )}
                          </article>
                        ))}
                      {!data.registrations.some(
                        (r) => filter === "ALL" || r.status === filter,
                      ) && (
                        <div className="empty-state">
                          <ClipboardList size={30} />
                          <h3>No applications here</h3>
                          <p>
                            New faction registrations will appear when captains
                            submit them.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}
                {(tab === "players" || tab === "teams") && (
                  <>
                    <div className="dev-filter">
                      <input
                        aria-label="Search registered competitors"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder={`Search registered ${tab}…`}
                      />
                      <span>
                        Removing a competitor hides them from the ladder and
                        keeps their history.
                      </span>
                    </div>
                    <div className="dev-table-wrap">
                      <table className="dev-table">
                        <thead>
                          <tr>
                            <th>{tab === "players" ? "PLAYER" : "TEAM"}</th>
                            <th>REGION</th>
                            <th>RATING</th>
                            <th>STATUS</th>
                            <th>ACTION</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tab === "players"
                            ? data.players
                                .filter((p) =>
                                  matches(`${p.username} ${p.display_name}`),
                                )
                                .map((p) => (
                                  <tr key={p.id}>
                                    <td>
                                      <strong>{p.display_name}</strong>
                                      <small>@{p.username}</small>
                                    </td>
                                    <td>{p.region}</td>
                                    <td className="mono">
                                      {Math.round(p.rating)}
                                    </td>
                                    <td>
                                      {p.is_active
                                        ? p.is_restricted
                                          ? "Restricted"
                                          : "Active"
                                        : "Banned"}
                                    </td>
                                    <td>
                                      <button
                                        className="button secondary"
                                        disabled={action.isPending}
                                        onClick={() =>
                                          action.mutate({
                                            path: `/dev/players/${p.id}/`,
                                            method: p.is_active
                                              ? "DELETE"
                                              : "PATCH",
                                            body: p.is_active
                                              ? undefined
                                              : { is_active: true },
                                            message: `${p.display_name} ${p.is_active ? "removed from" : "restored to"} the leaderboard.`,
                                          })
                                        }
                                      >
                                        {p.is_active ? "Remove" : "Restore"}
                                      </button>
                                    </td>
                                  </tr>
                                ))
                            : data.teams
                                .filter((t) =>
                                  matches(`${t.display_name} ${t.tag}`),
                                )
                                .map((t) => (
                                  <tr key={t.id}>
                                    <td>
                                      <strong>{t.display_name}</strong>
                                      <small>
                                        {t.tag} · {t.roster.length} players
                                      </small>
                                    </td>
                                    <td>{t.region}</td>
                                    <td className="mono">
                                      {Math.round(t.rating)}
                                    </td>
                                    <td>
                                      {t.is_active ? "Active" : "Removed"}
                                    </td>
                                    <td>
                                      <button
                                        className="button secondary"
                                        disabled={action.isPending}
                                        onClick={() =>
                                          action.mutate({
                                            path: `/dev/teams/${t.id}/`,
                                            method: t.is_active
                                              ? "DELETE"
                                              : "PATCH",
                                            body: t.is_active
                                              ? undefined
                                              : { is_active: true },
                                            message: `${t.display_name} ${t.is_active ? "removed from" : "restored to"} the leaderboard.`,
                                          })
                                        }
                                      >
                                        {t.is_active ? "Remove" : "Restore"}
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
                {tab === "events" && <EventManager />}
                {tab === "elo" && (
                  <EloControls
                    players={data.players}
                    factions={data.teams}
                    onSaved={refreshAdminData}
                  />
                )}
                {tab === "terminal" && (
                  <AdminTerminal onSaved={refreshAdminData} />
                )}
                {tab === "activity" && (
                  <div className="dev-activity">
                    {data.audit.map((a) => (
                      <div key={a.id}>
                        <ShieldCheck size={17} />
                        <span>
                          <strong>{a.action}</strong>
                          <small>
                            {a.actor} · {a.target_type} #{a.target_id}
                          </small>
                        </span>
                        <time>{new Date(a.created_at).toLocaleString()}</time>
                      </div>
                    ))}
                    {!data.audit.length && (
                      <p className="muted">No developer activity yet.</p>
                    )}
                  </div>
                )}
              </>
            )
          )}
          {form && data && (
            <AddCompetitor
              kind={form}
              players={data.players}
              onClose={() => setForm(null)}
              onSaved={() => {
                setForm(null);
                setNotice(
                  `${form === "player" ? "Player account" : "Team"} created.`,
                );
                void client.invalidateQueries({ queryKey: ["developer"] });
              }}
            />
          )}
        </main>
      )}
    </div>
  );
}

function AddCompetitor({
  kind,
  players,
  onClose,
  onSaved,
}: {
  kind: "player" | "team";
  players: DevPlayer[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [requestKey] = useState(() => crypto.randomUUID());
  const [draft, setDraft] = useState({
    username: "",
    display_name: "",
    region: "NA",
    password: "",
    password_confirm: "",
    tag: "",
    captain_username: "",
  });
  const [selected, setSelected] = useState<string[]>([]);
  const mutation = useMutation({
    mutationFn: () =>
      request(kind === "player" ? "/dev/players/" : "/dev/teams/", {
        method: "POST",
        body: JSON.stringify(
          kind === "player"
            ? {
                username: draft.username,
                display_name: draft.display_name,
                region: draft.region,
                password: draft.password,
                password_confirm: draft.password_confirm,
              }
            : {
                request_key: requestKey,
                team_name: draft.display_name,
                tag: draft.tag,
                region: draft.region,
                captain_username: draft.captain_username,
                members: Array.from(
                  new Set([draft.captain_username, ...selected]),
                ).map((username) => ({
                  username,
                  display_name:
                    players.find((p) => p.username === username)
                      ?.display_name || username,
                })),
              },
        ),
      }),
    onSuccess: onSaved,
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    mutation.mutate();
  }
  return (
    <Modal
      title={kind === "player" ? "ADD PLAYER ACCOUNT" : "ADD TEAM"}
      onClose={onClose}
    >
      <form className="dev-add-form" onSubmit={submit}>
        <h2>{kind === "player" ? "CREATE PLAYER ACCOUNT" : "CREATE TEAM"}</h2>
        <p>
          {kind === "player"
            ? "Create a normal player account with a password you can share with the player."
            : "Select an existing registered captain and roster. This creates an approved team."}
        </p>
        <label className="registration-field">
          {kind === "player" ? "Display name" : "Team name"}
          <input
            required
            minLength={2}
            maxLength={64}
            value={draft.display_name}
            onChange={(e) =>
              setDraft({ ...draft, display_name: e.target.value })
            }
          />
        </label>
        {kind === "player" ? (
          <label className="registration-field">
            Username
            <input
              required
              pattern="[a-zA-Z0-9_]{3,30}"
              value={draft.username}
              onChange={(e) => setDraft({ ...draft, username: e.target.value })}
            />
          </label>
        ) : (
          <label className="registration-field">
            Team tag
            <input
              required
              pattern="[A-Z0-9]{2,5}"
              maxLength={5}
              value={draft.tag}
              onChange={(e) =>
                setDraft({ ...draft, tag: e.target.value.toUpperCase() })
              }
            />
          </label>
        )}
        <label className="registration-field">
          Region
          <select
            aria-label="Region"
            value={draft.region}
            onChange={(e) => setDraft({ ...draft, region: e.target.value })}
          >
            <option value="NA">North America</option>
            <option value="EU">Europe</option>
            <option value="ASIA">Asia</option>
            <option value="SA">South America</option>
            <option value="OCE">Oceania</option>
          </select>
        </label>
        {kind === "player" ? (
          <>
            <label className="registration-field">
              Initial password
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={draft.password}
                onChange={(e) =>
                  setDraft({ ...draft, password: e.target.value })
                }
              />
            </label>
            <label className="registration-field">
              Confirm password
              <input
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={draft.password_confirm}
                onChange={(e) =>
                  setDraft({ ...draft, password_confirm: e.target.value })
                }
              />
            </label>
          </>
        ) : (
          <>
            <label className="registration-field">
              Captain
              <select
                aria-label="Captain"
                required
                value={draft.captain_username}
                onChange={(e) =>
                  setDraft({ ...draft, captain_username: e.target.value })
                }
              >
                <option value="">Choose a registered player</option>
                {players
                  .filter((p) => p.is_active)
                  .map((p) => (
                    <option key={p.id} value={p.username}>
                      {p.display_name} (@{p.username})
                    </option>
                  ))}
              </select>
            </label>
            <div className="dev-player-picker">
              <span>ROSTER · 2–10 REGISTERED PLAYERS</span>
              {players
                .filter((p) => p.is_active)
                .map((p) => (
                  <label key={p.id}>
                    <input
                      type="checkbox"
                      checked={
                        p.username === draft.captain_username ||
                        selected.includes(p.username)
                      }
                      disabled={p.username === draft.captain_username}
                      onChange={(e) =>
                        setSelected((old) =>
                          e.target.checked
                            ? [...old, p.username]
                            : old.filter((name) => name !== p.username),
                        )
                      }
                    />
                    {p.display_name}
                    <small>@{p.username}</small>
                  </label>
                ))}
            </div>
          </>
        )}
        {mutation.isError && (
          <p className="registration-error" role="alert">
            {mutation.error.message}
          </p>
        )}
        <button
          type="submit"
          className="button primary registration-submit"
          disabled={mutation.isPending}
        >
          {mutation.isPending
            ? "Creating…"
            : kind === "player"
              ? "Create player account"
              : "Create team"}
        </button>
      </form>
    </Modal>
  );
}
