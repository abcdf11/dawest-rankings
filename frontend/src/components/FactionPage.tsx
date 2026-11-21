import { useCallback, useEffect, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Crown,
  ImagePlus,
  LoaderCircle,
  Search,
  Shield,
  UsersRound,
  X,
} from "lucide-react";
import { ApiError, request } from "../lib/api";
import { factionUrl, profileUrl } from "../lib/profile";
import { formatRating } from "../lib/rating";
import { useSession } from "../hooks/useSession";
import type {
  FactionDetail,
  FactionManagement,
  FactionSummary,
  MyFactions,
} from "../types/factions";
import { AccountMenu } from "./AccountMenu";
import { MainNavigation } from "./MainNavigation";
import { Brand, Sigil, TierBadge } from "./Shared";
import { ProfileMediaImage } from "./ProfileMediaImage";
import { ProfileAppearanceEditor } from "./ProfileAppearanceEditor";
import { ThemeAudioEditor, ThemePlayer } from "./ThemeAudio";
import "../profile.css";
import "../factions.css";

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="profile-site faction-site">
      <header className="profile-site-header">
        <div>
          <a href="/" aria-label="DaWest rankings home">
            <Brand />
          </a>
          <MainNavigation />
          <AccountMenu />
        </div>
      </header>
      <main className="profile-page faction-page">{children}</main>
      <footer className="profile-site-footer">
        <span>DAWEST / FACTIONS</span>
      </footer>
    </div>
  );
}

function State({
  error,
  children,
}: {
  error?: Error | null;
  children?: ReactNode;
}) {
  return (
    <Frame>
      <div className="profile-state" role={error ? "alert" : "status"}>
        {error ? (
          <>
            <Shield size={32} />
            <h1>
              {error instanceof ApiError && error.status === 404
                ? "Faction unavailable"
                : "Could not load factions"}
            </h1>
            <p>{error.message}</p>
            <a className="button secondary" href="/factions">
              Explore factions
            </a>
          </>
        ) : (
          <>
            <LoaderCircle size={28} className="profile-spinner" />
            <p>{children || "Loading factions…"}</p>
          </>
        )}
      </div>
    </Frame>
  );
}

function useMyFactions() {
  const session = useSession();
  return useQuery({
    queryKey: ["my-factions"],
    queryFn: () => request<MyFactions>("/factions/mine/"),
    enabled: session.data?.authenticated === true,
    staleTime: 10_000,
  });
}

function useFactionAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ path, body = {} }: { path: string; body?: object }) =>
      request(path, { method: "POST", body: JSON.stringify(body) }),
    onSettled: () => {
      for (const key of [
        "faction",
        "factions",
        "my-factions",
        "rankings",
        "team",
        "player-profile",
      ])
        void client.invalidateQueries({ queryKey: [key] });
    },
  });
}

function FactionCard({
  faction,
  leader = false,
}: {
  faction: FactionSummary;
  leader?: boolean;
}) {
  return (
    <a className="faction-card" href={factionUrl(faction.username)}>
      <div className="faction-card-cover">
        {faction.banner_url ? (
          <ProfileMediaImage src={faction.banner_url} alt="" />
        ) : (
          <span>DAWEST</span>
        )}
      </div>
      <div className="faction-card-body">
        <div className="faction-card-logo">
          {faction.avatar_url ? (
            <ProfileMediaImage src={faction.avatar_url} alt="" />
          ) : (
            <Shield size={30} />
          )}
        </div>
        <div className="faction-card-meta">
          <span>
            [{faction.tag}] · {faction.region}
          </span>
          {leader && (
            <span>
              <Crown size={13} /> Leader
            </span>
          )}
        </div>
        <h3>{faction.display_name}</h3>
        <div className="faction-card-numbers">
          <span>
            <b>#{faction.rank}</b> global
          </span>
          <span>
            <b>{formatRating(faction.rating)}</b> PR
          </span>
          {faction.member_count !== undefined && (
            <span>
              {faction.member_count}/{faction.capacity} members
            </span>
          )}
        </div>
      </div>
    </a>
  );
}

export function FactionRedirect({ username }: { username?: string }) {
  const session = useSession();
  const mine = useMyFactions();
  useEffect(() => {
    if (username) {
      window.location.replace(factionUrl(username));
      return;
    }
    if (!session.data) return;
    if (!session.data.authenticated) {
      window.location.replace("/login?next=/faction");
      return;
    }
    if (!mine.data) return;
    const target =
      mine.data.membership ??
      (mine.data.owned.length === 1 ? mine.data.owned[0] : null);
    window.location.replace(target ? factionUrl(target.username) : "/factions");
  }, [username, session.data, mine.data]);
  return (
    <State error={session.error || mine.error}>Opening your faction…</State>
  );
}

export function FactionsDirectory() {
  const session = useSession();
  const mine = useMyFactions();
  const directory = useQuery({
    queryKey: ["factions"],
    queryFn: () => request<{ factions: FactionSummary[] }>("/factions/"),
  });
  const action = useFactionAction();
  const [search, setSearch] = useState("");
  const own = mine.data
    ? [
        ...mine.data.owned,
        ...(mine.data.membership &&
        !mine.data.owned.some((team) => team.id === mine.data!.membership!.id)
          ? [mine.data.membership]
          : []),
      ]
    : [];
  const pending =
    mine.data?.requests.filter((row) => row.status === "PENDING") ?? [];
  if (directory.isPending) return <State />;
  if (directory.error) return <State error={directory.error} />;
  const filtered = directory.data.factions.filter((team) =>
    `${team.display_name} ${team.tag} ${team.region}`
      .toLowerCase()
      .includes(search.toLowerCase().trim()),
  );
  return (
    <Frame>
      <div className="faction-directory-heading">
        <div>
          <h1>Factions</h1>
          <p>Browse approved factions and request membership.</p>
        </div>
        <a className="button primary" href="/register">
          <Shield size={16} /> Register a faction
        </a>
      </div>
      {session.data?.authenticated && (
        <section className="faction-section">
          <div className="faction-section-heading">
            <h2>Your factions</h2>
          </div>
          {mine.isPending ? (
            <p role="status">Loading your factions…</p>
          ) : mine.error ? (
            <p role="alert">{mine.error.message}</p>
          ) : own.length ? (
            <div className="faction-grid">
              {own.map((team) => (
                <FactionCard
                  key={team.id}
                  faction={team}
                  leader={mine.data?.owned.some(
                    (owned) => owned.id === team.id,
                  )}
                />
              ))}
            </div>
          ) : (
            <div className="faction-empty">
              <UsersRound size={25} />
              <h3>No faction membership</h3>
              <p>Request to join a faction or register one.</p>
            </div>
          )}
          {pending.length > 0 && (
            <div className="faction-pending">
              <h3>Your pending requests</h3>
              {pending.map((row) => (
                <div className="faction-pending-row" key={row.id}>
                  <a href={factionUrl(row.faction.username)}>
                    {row.faction.display_name}
                  </a>
                  <span className="faction-status">Awaiting leader review</span>
                  <button
                    className="faction-text-button"
                    disabled={action.isPending}
                    onClick={() =>
                      action.mutate({
                        path: `/factions/requests/${row.id}/withdraw/`,
                      })
                    }
                  >
                    Withdraw request
                  </button>
                </div>
              ))}
            </div>
          )}
          {action.error && (
            <p className="registration-error" role="alert">
              {action.error.message}
            </p>
          )}
        </section>
      )}
      <section className="faction-section">
        <div className="faction-section-heading">
          <h2>
            Explore factions <small>{directory.data.factions.length}</small>
          </h2>
          <label className="faction-search">
            <Search size={16} />
            <input
              aria-label="Search factions"
              value={search}
              placeholder="Name, tag, or region"
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        {filtered.length ? (
          <div className="faction-grid">
            {filtered.map((team) => (
              <FactionCard key={team.id} faction={team} />
            ))}
          </div>
        ) : (
          <div className="faction-empty">
            <Shield size={26} />
            <h3>{search ? "No factions found" : "No factions yet"}</h3>
            <p>
              {search
                ? "Try another name, tag, or region."
                : "Approved teams will appear here. Register yours to get started."}
            </p>
          </div>
        )}
      </section>
    </Frame>
  );
}

export default function FactionPage({
  username,
  managing = false,
}: {
  username: string;
  managing?: boolean;
}) {
  const session = useSession();
  const mine = useMyFactions();
  const [editing, setEditing] = useState(false);
  const closeEditor = useCallback(() => setEditing(false), []);
  const [message, setMessage] = useState("");
  const [removing, setRemoving] = useState<number | null>(null);
  const [tab, setTab] = useState<"members" | "matches">("members");
  const action = useFactionAction();
  const profile = useQuery({
    queryKey: ["faction", username, managing],
    queryFn: async (): Promise<FactionManagement> =>
      managing
        ? request(`/factions/${encodeURIComponent(username)}/manage/`)
        : {
            faction: await request<FactionDetail>(
              `/factions/${encodeURIComponent(username)}/`,
            ),
            requests: [],
            recent_requests: [],
          },
    enabled: !managing || session.data?.authenticated === true,
    staleTime: 10_000,
    refetchInterval: managing ? 30_000 : false,
    retry: false,
  });
  useEffect(() => {
    if (managing && session.data && !session.data.authenticated)
      window.location.replace(
        `/login?next=${encodeURIComponent(`${factionUrl(username)}/manage`)}`,
      );
  }, [managing, session.data, username]);
  const faction = profile.data?.faction;
  function switchTab(event: KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? "members"
        : event.key === "End"
          ? "matches"
          : tab === "members"
            ? "matches"
            : "members";
    setTab(next);
    document.getElementById(`faction-${next}-tab`)?.focus();
  }
  useEffect(() => {
    if (!faction) return;
    const previous = document.title;
    document.title = `${faction.display_name} · DAWEST Factions`;
    return () => {
      document.title = previous;
    };
  }, [faction]);
  if (profile.error) return <State error={profile.error} />;
  if (!faction || !profile.data) return <State />;
  const owner = Boolean(
    !session.data?.user?.player?.is_restricted &&
    mine.data?.owned.some((team) => team.username === faction.username),
  );
  const member = faction.members.find(
    (player) => player.id === session.data?.user?.player?.id,
  );
  const pending = mine.data?.requests.find(
    (row) =>
      row.faction.username === faction.username && row.status === "PENDING",
  );
  const root = `/factions/${encodeURIComponent(faction.username)}`;
  const submit = (path: string, body?: object) =>
    action.mutate(
      { path: `${root}${path}`, body },
      {
        onSuccess: () => {
          setRemoving(null);
          setMessage("");
        },
      },
    );
  return (
    <Frame>
      <div className="profile-breadcrumb">
        <a href="/factions">Factions</a>
        <span>/</span>
        <strong>{faction.display_name}</strong>
        {managing && (
          <>
            <span>/</span>
            <strong>Leader dashboard</strong>
          </>
        )}
      </div>
      <article className="faction-profile">
        <div
          className={`faction-cover ${faction.banner_url ? "has-image" : ""}`}
        >
          {faction.banner_url ? (
            <ProfileMediaImage
              src={faction.banner_url}
              alt={`${faction.display_name}'s faction banner`}
            />
          ) : (
            <span className="faction-cover-word">DAWEST</span>
          )}
          <div className="faction-cover-caption">
            <span>
              <Shield size={15} /> FACTION PROFILE
            </span>
            <span>
              {faction.region} / [{faction.tag}]
            </span>
          </div>
        </div>
        <div className="faction-identity">
          <div className="faction-logo">
            <Sigil player={faction} large />
          </div>
          <div className="faction-name">
            <TierBadge tier={faction.tier} />
            <h1>{faction.display_name}</h1>
            <p>
              [{faction.tag}] <span>·</span> {faction.region} <span>·</span>{" "}
              {faction.member_count}/{faction.capacity} members
            </p>
          </div>
          <div className="faction-identity-actions">
            {owner && (
              <a
                className="button primary"
                href={`${factionUrl(faction.username)}${managing ? "" : "/manage"}`}
              >
                {managing ? "View faction profile" : "Leader dashboard"}
              </a>
            )}
            {(owner || managing) && (
              <button
                className="button secondary"
                onClick={() => setEditing(true)}
              >
                <ImagePlus size={15} /> Customize faction
              </button>
            )}
          </div>
        </div>
        {!managing && faction.audio_url && (
          <ThemePlayer
            src={faction.audio_url}
            title={faction.audio_title}
            ownerName={faction.display_name}
          />
        )}
        <div className="faction-stats">
          <div>
            <span>GLOBAL RANK</span>
            <strong>#{faction.rank}</strong>
          </div>
          <div>
            <span>POWER RATING</span>
            <strong>{formatRating(faction.rating)}</strong>
          </div>
          <div>
            <span>MATCH RECORD</span>
            <strong>
              {faction.wins} <small>W</small> <i>/</i> {faction.losses}{" "}
              <small>L</small>
            </strong>
          </div>
          <div>
            <span>FACTION LEADER</span>
            {faction.leader ? (
              <a href={profileUrl(faction.leader.username)}>
                <Crown size={15} /> {faction.leader.display_name}
              </a>
            ) : (
              <strong>—</strong>
            )}
          </div>
        </div>
        {faction.description && (
          <p className="faction-description">{faction.description}</p>
        )}
        {!managing && !member && !owner && (
          <section className="faction-join">
            <div>
              <h2>Join {faction.display_name}</h2>
              <p>
                {pending
                  ? "Your request is awaiting the faction leader's review."
                  : "Send the leader a request to join this roster."}
              </p>
            </div>
            {!session.data?.authenticated ? (
              <a
                className="button primary"
                href={`/login?next=${encodeURIComponent(factionUrl(faction.username))}`}
              >
                Log in to join
              </a>
            ) : session.data.user?.player?.is_restricted ? (
              <p>Your account is restricted from joining factions.</p>
            ) : mine.isPending ? (
              <span role="status">Checking membership…</span>
            ) : mine.error ? (
              <p role="alert">{mine.error.message}</p>
            ) : pending ? (
              <button
                className="button secondary"
                disabled={action.isPending}
                onClick={() =>
                  action.mutate({
                    path: `/factions/requests/${pending.id}/withdraw/`,
                  })
                }
              >
                Withdraw request
              </button>
            ) : mine.data?.membership ? (
              <p>
                You're already part of{" "}
                <a href={factionUrl(mine.data.membership.username)}>
                  {mine.data.membership.display_name}
                </a>
                .
              </p>
            ) : faction.member_count >= faction.capacity ? (
              <span className="faction-status">Roster full</span>
            ) : !session.data?.user?.player ? (
              <p>A registered player account is required to join.</p>
            ) : (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  submit("/join/", { message });
                }}
              >
                <label htmlFor="faction-message">
                  Message to leader <small>(optional)</small>
                </label>
                <textarea
                  id="faction-message"
                  maxLength={500}
                  rows={2}
                  placeholder="Tell them a little about yourself."
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                />
                <button className="button primary" disabled={action.isPending}>
                  {action.isPending ? "Sending request…" : "Request to join"}
                </button>
              </form>
            )}
          </section>
        )}
      </article>
      {action.error && (
        <p className="registration-error faction-feedback" role="alert">
          {action.error.message}
        </p>
      )}
      {managing && (
        <section
          className="faction-section"
          aria-labelledby="faction-audio-title"
        >
          <div className="faction-section-heading">
            <div>
              <span className="eyebrow">LEADER DASHBOARD</span>
              <h2 id="faction-audio-title">Theme audio</h2>
            </div>
          </div>
          <ThemeAudioEditor
            endpoint={`/factions/${encodeURIComponent(faction.username)}/audio/`}
            audioUrl={faction.audio_url}
            audioTitle={faction.audio_title}
            refresh={[["faction", faction.username]]}
            profileLabel="your faction profile"
          />
        </section>
      )}
      {managing && (
        <section className="faction-section faction-inbox">
          <div className="faction-section-heading">
            <div>
              <span className="eyebrow">LEADER DASHBOARD</span>
              <h2>
                Member requests <small>{profile.data.requests.length}</small>
              </h2>
            </div>
          </div>
          {profile.data.requests.length === 0 ? (
            <div className="faction-empty">
              <Check size={25} />
              <h3>No pending requests</h3>
              <p>New join requests will appear here.</p>
            </div>
          ) : (
            <div className="faction-request-list">
              {profile.data.requests.map((row) => (
                <article className="faction-request" key={row.id}>
                  <div className="faction-request-player">
                    <div className="faction-person-image">
                      {row.player.avatar_url ? (
                        <ProfileMediaImage src={row.player.avatar_url} alt="" />
                      ) : (
                        <UsersRound size={20} />
                      )}
                    </div>
                    <div>
                      <a href={profileUrl(row.player.username)}>
                        {row.player.display_name}
                      </a>
                      <span>
                        @{row.player.username} · {row.player.region} ·{" "}
                        {formatRating(row.player.rating)} PR
                      </span>
                    </div>
                    <time>{new Date(row.created_at).toLocaleDateString()}</time>
                  </div>
                  <p>
                    {row.message ||
                      "This player would like to join your faction."}
                  </p>
                  <div className="faction-request-actions">
                    <button
                      className="button secondary"
                      disabled={action.isPending}
                      onClick={() =>
                        submit(`/requests/${row.id}/review/`, {
                          decision: "REJECTED",
                        })
                      }
                    >
                      <X size={15} /> Decline
                    </button>
                    <button
                      className="button primary"
                      disabled={action.isPending}
                      onClick={() =>
                        submit(`/requests/${row.id}/review/`, {
                          decision: "ACCEPTED",
                        })
                      }
                    >
                      <Check size={15} /> Accept member
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {profile.data.recent_requests.length > 0 && (
            <details className="faction-decisions">
              <summary>Recent decisions</summary>
              {profile.data.recent_requests.map((row) => (
                <div key={row.id}>
                  <a href={profileUrl(row.player.username)}>
                    {row.player.display_name}
                  </a>
                  <span>{row.status.toLowerCase()}</span>
                </div>
              ))}
            </details>
          )}
        </section>
      )}
      <section className="faction-section">
        <div
          className="faction-tabs"
          role="tablist"
          aria-label="Faction information"
        >
          <button
            role="tab"
            aria-selected={tab === "members"}
            tabIndex={tab === "members" ? 0 : -1}
            onKeyDown={switchTab}
            id="faction-members-tab"
            aria-controls="faction-panel"
            onClick={() => setTab("members")}
          >
            Members <span>{faction.member_count}</span>
          </button>
          <button
            role="tab"
            aria-selected={tab === "matches"}
            tabIndex={tab === "matches" ? 0 : -1}
            onKeyDown={switchTab}
            id="faction-matches-tab"
            aria-controls="faction-panel"
            onClick={() => setTab("matches")}
          >
            Recent matches
          </button>
        </div>
        <div
          id="faction-panel"
          role="tabpanel"
          aria-labelledby={`faction-${tab}-tab`}
        >
          {tab === "members" ? (
            <div className="faction-member-list">
              {faction.members.map((player) => (
                <div className="faction-member" key={player.id}>
                  <a
                    className="faction-member-profile"
                    href={profileUrl(player.username)}
                  >
                    <Sigil player={player} />
                    <span>
                      <strong>{player.display_name}</strong>
                      <small>
                        @{player.username} · {player.region}
                      </small>
                    </span>
                  </a>
                  <span className="faction-member-role">
                    {player.is_leader || player.is_captain ? (
                      <>
                        <Crown size={13} /> Leader
                      </>
                    ) : (
                      "Member"
                    )}
                  </span>
                  <span className="faction-member-rating">
                    {formatRating(player.rating)} <small>PR</small>
                  </span>
                  {!player.is_leader &&
                    !player.is_captain &&
                    ((managing && owner) || player.id === member?.id) && (
                      <div className="faction-member-controls">
                        {removing === player.id ? (
                          <>
                            <span>
                              {managing ? "Remove member?" : "Leave faction?"}
                            </span>
                            <button
                              className="faction-text-button"
                              disabled={action.isPending}
                              onClick={() =>
                                submit(`/members/${player.id}/remove/`)
                              }
                            >
                              Confirm
                            </button>
                            <button
                              className="faction-text-button"
                              onClick={() => setRemoving(null)}
                            >
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className="faction-text-button"
                            onClick={() => setRemoving(player.id)}
                          >
                            {managing ? "Remove" : "Leave faction"}
                          </button>
                        )}
                      </div>
                    )}
                </div>
              ))}
              {faction.members.length === 0 && (
                <p className="faction-empty">No active members to display.</p>
              )}
            </div>
          ) : faction.matches.length ? (
            <div className="faction-matches">
              {faction.matches.map((match) => (
                <a href={factionUrl(match.opponent_username)} key={match.id}>
                  <strong
                    className={`faction-result result-${match.result.toLowerCase()}`}
                  >
                    {match.result}
                  </strong>
                  <span>
                    <b>{match.opponent}</b>
                    <small>{match.event}</small>
                  </span>
                  <strong>{match.score}</strong>
                  <span>
                    {match.delta > 0 ? "+" : ""}
                    {formatRating(match.delta)} PR
                  </span>
                </a>
              ))}
            </div>
          ) : (
            <div className="faction-empty">
              <Shield size={25} />
              <h3>No matches yet</h3>
              <p>No verified faction matches yet.</p>
            </div>
          )}
        </div>
      </section>
      {editing && (
        <ProfileAppearanceEditor
          faction
          player={faction}
          onClose={closeEditor}
          onSaved={closeEditor}
        />
      )}
    </Frame>
  );
}
