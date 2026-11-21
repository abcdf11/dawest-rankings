import { useEffect, useState } from "react";
import type { ReactNode, KeyboardEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Award,
  BadgeCheck,
  CalendarDays,
  Check,
  Crosshair,
  Flame,
  Globe2,
  History as HistoryIcon,
  Link2,
  LoaderCircle,
  Medal,
  ShieldCheck,
  Swords,
  Target,
  Trophy,
  UserRound,
  UsersRound,
} from "lucide-react";
import { ApiError, getPlayerProfile } from "../lib/api";
import { accountDestination, profileUrl } from "../lib/profile";
import { formatRating, tierLabel } from "../lib/rating";
import { useSession } from "../hooks/useSession";
import type { Form, History, PlayerDetail, Region } from "../types/rankings";
import { AccountMenu } from "./AccountMenu";
import { Brand, Delta, TierBadge } from "./Shared";
import "../profile.css";

const regions: Record<Region, string> = {
  NA: "North America",
  EU: "Europe",
  ASIA: "Asia",
  SA: "South America",
  OCE: "Oceania",
};
const tabs = ["overview", "matches", "activity"] as const;
type Tab = (typeof tabs)[number];
const date = (
  value: string,
  options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  },
) => {
  const parsed = new Date(value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime())
    ? "Date unavailable"
    : parsed.toLocaleDateString(undefined, options);
};

function ProfileFrame({ children }: { children: ReactNode }) {
  return (
    <div className="profile-site">
      <header className="profile-site-header">
        <div>
          <a href="/" aria-label="DaWest rankings home">
            <Brand />
          </a>
          <nav aria-label="Main navigation">
            <a href="/">Rankings</a>
            <a href="/?ranking=teams">Teams</a>
            <a href="/register">Register a team</a>
          </nav>
          <AccountMenu />
        </div>
      </header>
      <main className="profile-page">{children}</main>
      <footer className="profile-site-footer">
        <span>DAWEST / COMPETITIVE INDEX</span>
        <span>Every result is part of your story.</span>
      </footer>
    </div>
  );
}

export function ProfileRedirect() {
  const session = useSession();
  useEffect(() => {
    if (!session.data) return;
    window.location.replace(
      session.data.authenticated
        ? accountDestination(session.data.user)
        : "/login?next=/profile",
    );
  }, [session.data]);
  return (
    <ProfileFrame>
      <div className="profile-state" role="status">
        {session.isError ? (
          <>
            <UserRound size={32} />
            <h1>Could not open your profile.</h1>
            <button
              className="button secondary"
              onClick={() => void session.refetch()}
            >
              Try again
            </button>
          </>
        ) : (
          <>
            <LoaderCircle className="profile-spinner" size={30} />
            <p>Opening your profile…</p>
          </>
        )}
      </div>
    </ProfileFrame>
  );
}

export default function ProfilePage({ username }: { username: string }) {
  const session = useSession();
  const profile = useQuery({
    queryKey: ["player-profile", username],
    queryFn: () => getPlayerProfile(username),
    staleTime: 30_000,
    retry: (attempt, error) =>
      !(error instanceof ApiError && error.status === 404) && attempt < 1,
  });
  const [tab, setTab] = useState<Tab>(
    () =>
      tabs.find((item) => window.location.hash === `#${item}`) ?? "overview",
  );
  const [copied, setCopied] = useState<"idle" | "copied" | "error">("idle");
  const [avatarFailed, setAvatarFailed] = useState(false);
  const player = profile.data;
  const ownProfile = Boolean(
    player && session.data?.user?.player?.username === player.username,
  );
  useEffect(() => {
    if (!player) return;
    const previous = document.title;
    document.title = `${player.display_name} · DAWEST`;
    return () => {
      document.title = previous;
    };
  }, [player]);
  useEffect(() => {
    const change = () =>
      setTab(
        tabs.find((item) => window.location.hash === `#${item}`) ?? "overview",
      );
    window.addEventListener("hashchange", change);
    return () => window.removeEventListener("hashchange", change);
  }, []);
  function selectTab(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.hash = next === "overview" ? "" : next;
    window.history.replaceState(null, "", url);
  }
  function tabKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % 3
        : event.key === "ArrowLeft"
          ? (index + 2) % 3
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? 2
              : null;
    if (next === null) return;
    event.preventDefault();
    selectTab(tabs[next]);
    document.getElementById(`profile-tab-${tabs[next]}`)?.focus();
  }
  async function copyProfile() {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}${profileUrl(player!.username)}`,
      );
      setCopied("copied");
    } catch {
      setCopied("error");
    }
  }
  if (profile.isPending)
    return (
      <ProfileFrame>
        <div className="profile-state" role="status">
          <LoaderCircle className="profile-spinner" size={30} />
          <p>Loading player profile…</p>
        </div>
      </ProfileFrame>
    );
  if (!player) {
    const missing =
      profile.error instanceof ApiError && profile.error.status === 404;
    return (
      <ProfileFrame>
        <div className="profile-state">
          <UserRound size={36} />
          <span className="profile-eyebrow">PLAYER PROFILE</span>
          <h1>{missing ? "Player not found." : "Profile unavailable."}</h1>
          <p>
            {missing
              ? "This player is not registered or their profile is currently unavailable."
              : "We could not load this player's record. Please try again."}
          </p>
          <div>
            <a className="button secondary" href="/">
              Back to rankings
            </a>
            {!missing && (
              <button
                className="button primary"
                onClick={() => void profile.refetch()}
              >
                Try again
              </button>
            )}
          </div>
        </div>
      </ProfileFrame>
    );
  }
  const total = player.wins + player.losses;
  const standout = player.matches
    .filter((match) => match.result === "W")
    .sort((a, b) => b.delta - a.delta)
    .slice(0, 3);
  return (
    <ProfileFrame>
      <div className="profile-breadcrumb">
        <a href="/">Rankings</a>
        <span>/</span>
        <span>Players</span>
        <span>/</span>
        <strong>@{player.username}</strong>
      </div>
      <article className="player-profile">
        <div className="profile-cover">
          <div className="profile-cover-art" aria-hidden="true">
            <span>DAWEST</span>
            <i />
            <i />
            <i />
          </div>
          <div className="profile-cover-top">
            <span>
              <UserRound size={14} /> PLAYER PROFILE
            </span>
            <span>SOLO / 1V1</span>
          </div>
          <div className="profile-cover-bottom">
            <span>REPUTATION IS EVERYTHING.</span>
            <span>
              <ShieldCheck size={14} /> REGISTERED PLAYER
            </span>
          </div>
        </div>
        <div className="profile-identity">
          <div
            className="profile-avatar"
            role="img"
            aria-label={`${player.display_name}'s avatar`}
          >
            {player.avatar_url && !avatarFailed ? (
              <img
                src={player.avatar_url}
                alt=""
                onError={() => setAvatarFailed(true)}
              />
            ) : (
              <span>{player.display_name.slice(0, 2).toUpperCase()}</span>
            )}
            <BadgeCheck size={26} className="profile-avatar-badge" />
          </div>
          <div className="profile-name">
            <div>
              <h1>{player.display_name}</h1>
              <TierBadge tier={player.tier} />
            </div>
            <p>
              <span>@{player.username}</span>
              <span>
                <Globe2 size={14} /> {regions[player.region]}
              </span>
              {ownProfile && (
                <span className="profile-own-label">Your profile</span>
              )}
            </p>
          </div>
          <div className="profile-identity-actions">
            <button
              className="profile-copy"
              onClick={() => void copyProfile()}
              aria-label="Copy profile link"
            >
              {copied === "copied" ? <Check size={16} /> : <Link2 size={16} />}
              <span>{copied === "copied" ? "Copied" : "Share profile"}</span>
            </button>
          </div>
        </div>
        {copied === "error" && (
          <div className="profile-copy-fallback" role="status">
            <span>Select and copy your profile link:</span>
            <input
              aria-label="Profile URL"
              readOnly
              value={`${window.location.origin}${profileUrl(player.username)}`}
              onFocus={(event) => event.target.select()}
            />
          </div>
        )}
        <div
          className="profile-tabs"
          role="tablist"
          aria-label="Profile sections"
        >
          {tabs.map((item, index) => (
            <button
              key={item}
              role="tab"
              id={`profile-tab-${item}`}
              aria-controls="profile-tabpanel"
              aria-selected={tab === item}
              tabIndex={tab === item ? 0 : -1}
              onKeyDown={(event) => tabKeys(event, index)}
              onClick={() => selectTab(item)}
            >
              {item === "overview" ? (
                <UserRound size={16} />
              ) : item === "matches" ? (
                <Swords size={16} />
              ) : (
                <Activity size={16} />
              )}
              {item.charAt(0).toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
        <div
          className="profile-body"
          id="profile-tabpanel"
          role="tabpanel"
          aria-labelledby={`profile-tab-${tab}`}
        >
          <aside className="profile-sidebar">
            <section className="profile-side-card profile-about">
              <h2>On the frontier</h2>
              <dl>
                <div>
                  <dt>
                    <Globe2 size={16} /> Region
                  </dt>
                  <dd>{regions[player.region]}</dd>
                </div>
                <div>
                  <dt>
                    <CalendarDays size={16} /> Joined
                  </dt>
                  <dd>
                    {player.registered_at
                      ? date(player.registered_at)
                      : "Registered player"}
                  </dd>
                </div>
                <div>
                  <dt>
                    <UsersRound size={16} /> Team
                  </dt>
                  <dd>
                    {player.team?.display_name ?? "Independent"}
                    {player.team && <small>[{player.team.tag}]</small>}
                  </dd>
                </div>
                <div>
                  <dt>
                    <ShieldCheck size={16} /> Division
                  </dt>
                  <dd>{tierLabel(player.tier)}</dd>
                </div>
              </dl>
              {ownProfile && !player.team && (
                <a href="/register" className="profile-side-link">
                  Register your team
                </a>
              )}
            </section>
            <section className="profile-side-card profile-career">
              <div className="profile-section-title">
                <h2>Career record</h2>
                <Trophy size={17} />
              </div>
              <div
                className="profile-win-ring"
                style={
                  {
                    "--win-angle": `${player.win_rate * 3.6}deg`,
                  } as React.CSSProperties
                }
              >
                <div>
                  <strong>
                    {player.win_rate.toFixed(1)}
                    <small>%</small>
                  </strong>
                  <span>WIN RATE</span>
                </div>
              </div>
              <div className="profile-record-count">
                <span>
                  <strong>{player.wins}</strong>Wins
                </span>
                <span>
                  <strong>{player.losses}</strong>Losses
                </span>
                <span>
                  <strong>{total}</strong>Matches
                </span>
              </div>
            </section>
            <div className="profile-side-note">
              <ShieldCheck size={17} />
              <p>
                Every result counts.
                <br />
                Your record comes from verified competition.
              </p>
            </div>
          </aside>
          <div className="profile-main">
            <div className="profile-ranks">
              <div>
                <span>
                  <Trophy size={15} /> Global ranking
                </span>
                <strong>
                  #{player.rank.toLocaleString()}
                  <Delta value={player.rank_delta} />
                </strong>
              </div>
              <div>
                <span>
                  <Globe2 size={15} /> Regional ranking
                </span>
                <strong>
                  #{player.regional_rank.toLocaleString()}
                  <small>{player.region}</small>
                </strong>
              </div>
              <div className="profile-power">
                <span>
                  <Crosshair size={15} /> Power rating
                </span>
                <strong>
                  {formatRating(player.rating)}
                  <small>PR</small>
                </strong>
              </div>
            </div>
            {tab === "overview" ? (
              <>
                <PerformanceChart
                  history={player.history}
                  name={player.display_name}
                />
                <div className="profile-stat-strip">
                  <div>
                    <span>Total matches</span>
                    <strong>{total.toLocaleString()}</strong>
                  </div>
                  <div>
                    <span>Peak rating</span>
                    <strong>{formatRating(player.peak_rating)}</strong>
                  </div>
                  <div>
                    <span>Round K/D</span>
                    <strong>{player.kd_ratio.toFixed(2)}</strong>
                  </div>
                  <div>
                    <span>Current streak</span>
                    <strong>
                      <Flame size={17} />
                      {Math.abs(player.current_streak)}
                      <small>
                        {player.current_streak < 0 ? "losses" : "wins"}
                      </small>
                    </strong>
                  </div>
                </div>
                <section className="profile-panel">
                  <div className="profile-section-title">
                    <div>
                      <h2>Recent matches</h2>
                      <p>The latest chapters in your record.</p>
                    </div>
                    <button
                      className="profile-text-button"
                      onClick={() => selectTab("matches")}
                    >
                      View all matches
                    </button>
                  </div>
                  <MatchRows
                    matches={player.matches.slice(0, 5)}
                    own={ownProfile}
                  />
                </section>
                {standout.length > 0 && (
                  <section className="profile-panel">
                    <div className="profile-section-title">
                      <div>
                        <h2>Standout wins</h2>
                        <p>Highest rating gains from recent matches.</p>
                      </div>
                      <Award size={19} />
                    </div>
                    <MatchRows matches={standout} own={ownProfile} />
                  </section>
                )}
                <Milestones player={player} />
              </>
            ) : tab === "matches" ? (
              <MatchHistory player={player} own={ownProfile} />
            ) : (
              <section className="profile-panel">
                <div className="profile-section-title">
                  <div>
                    <h2>Recent activity</h2>
                    <p>Rating changes and competition milestones.</p>
                  </div>
                  <HistoryIcon size={19} />
                </div>
                {player.history.length ? (
                  <ol className="profile-activity">
                    {[...player.history]
                      .reverse()
                      .slice(0, 20)
                      .map((entry, index) => (
                        <li key={`${entry.recorded_at}-${index}`}>
                          <span className="profile-activity-icon">
                            <Activity size={17} />
                          </span>
                          <div>
                            <strong>{entry.event_label}</strong>
                            <time dateTime={entry.recorded_at}>
                              {date(entry.recorded_at)}
                            </time>
                          </div>
                          <span>
                            {formatRating(entry.rating)}
                            <small>PR · #{entry.rank}</small>
                          </span>
                        </li>
                      ))}
                  </ol>
                ) : (
                  <EmptyRecord own={ownProfile} />
                )}
              </section>
            )}
          </div>
        </div>
      </article>
    </ProfileFrame>
  );
}

function EmptyRecord({ own }: { own: boolean }) {
  return (
    <div className="profile-empty">
      <Crosshair size={27} />
      <h3>{own ? "Your record starts here." : "No matches recorded yet."}</h3>
      <p>Verified match results will appear here as you compete.</p>
    </div>
  );
}

function MatchRows({ matches, own }: { matches: Form[]; own: boolean }) {
  if (!matches.length) return <EmptyRecord own={own} />;
  return (
    <div className="profile-match-list">
      {matches.map((match) => (
        <div
          className={`profile-match-row ${match.result === "W" ? "is-win" : "is-loss"}`}
          key={match.id}
        >
          <span
            className="profile-result"
            aria-label={match.result === "W" ? "Win" : "Loss"}
          >
            {match.result}
          </span>
          <div className="profile-match-info">
            <a href={profileUrl(match.opponent_username)}>
              vs {match.opponent}
            </a>
            <span>
              {match.event}
              <span>·</span>
              <time dateTime={match.played_at}>
                {date(match.played_at, { month: "short", day: "numeric" })}
              </time>
            </span>
          </div>
          <span className="profile-match-score">
            {match.score.match(/\d+/g)?.join(" : ") ?? match.score}
          </span>
          <span className="profile-match-gain">
            {match.delta > 0 ? "+" : ""}
            {match.delta.toFixed(1)}
            <small>PR</small>
          </span>
        </div>
      ))}
    </div>
  );
}

function MatchHistory({ player, own }: { player: PlayerDetail; own: boolean }) {
  const [filter, setFilter] = useState<"all" | "W" | "L">("all");
  const matches = player.matches.filter(
    (match) => filter === "all" || match.result === filter,
  );
  return (
    <section className="profile-panel">
      <div className="profile-section-title">
        <div>
          <h2>Match history</h2>
          <p>The latest {player.matches.length} verified matches.</p>
        </div>
        <Swords size={19} />
      </div>
      <div className="profile-match-filters" aria-label="Filter match history">
        {(
          [
            ["all", "All results"],
            ["W", "Wins"],
            ["L", "Losses"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {label}
            <span>
              {value === "all"
                ? player.matches.length
                : player.matches.filter((match) => match.result === value)
                    .length}
            </span>
          </button>
        ))}
      </div>
      {matches.length ? (
        <MatchRows matches={matches} own={own} />
      ) : filter === "all" ? (
        <EmptyRecord own={own} />
      ) : (
        <div className="profile-empty">
          <Swords size={26} />
          <h3>No {filter === "W" ? "wins" : "losses"} in recent matches.</h3>
          <button
            className="profile-text-button"
            onClick={() => setFilter("all")}
          >
            Show all results
          </button>
        </div>
      )}
    </section>
  );
}

function PerformanceChart({
  history,
  name,
}: {
  history: History[];
  name: string;
}) {
  const [metric, setMetric] = useState<"rating" | "rank">("rating");
  const [selected, setSelected] = useState<number | null>(null);
  const rows = history.filter(
    (entry) => Number.isFinite(entry.rating) && Number.isFinite(entry.rank),
  );
  const index = Math.max(
    0,
    Math.min(selected ?? rows.length - 1, rows.length - 1),
  );
  const current = rows[index];
  const values = rows.length ? rows.map((entry) => entry[metric]) : [0];
  const padding = Math.max(
    (Math.max(...values) - Math.min(...values)) * 0.2,
    metric === "rank" ? 1 : 30,
  );
  const lower = Math.max(
    metric === "rank" ? 1 : 0,
    Math.min(...values) - padding,
  );
  const upper = Math.max(...values) + padding;
  const x = (i: number) =>
    rows.length === 1 ? 360 : 18 + (i / (rows.length - 1)) * 684;
  const y = (i: number) =>
    metric === "rank"
      ? 20 + ((rows[i].rank - lower) / (upper - lower)) * 152
      : 172 - ((rows[i].rating - lower) / (upper - lower)) * 152;
  const points = rows.map((_, i) => `${x(i)},${y(i)}`).join(" ");
  const valueText = (entry: History) =>
    metric === "rank"
      ? `#${entry.rank.toLocaleString()}`
      : `${formatRating(entry.rating)} PR`;
  return (
    <section className="profile-panel profile-performance">
      <div className="profile-section-title">
        <div>
          <h2>Performance history</h2>
          <p>
            {current
              ? current.event_label
              : "Your journey, one result at a time."}
          </p>
        </div>
        <div className="profile-chart-switch" aria-label="History metric">
          <button
            aria-pressed={metric === "rating"}
            onClick={() => setMetric("rating")}
          >
            Power rating
          </button>
          <button
            aria-pressed={metric === "rank"}
            onClick={() => setMetric("rank")}
          >
            Global rank
          </button>
        </div>
      </div>
      {current ? (
        <>
          <div className="profile-chart-current">
            <strong>{valueText(current)}</strong>
            <time dateTime={current.recorded_at}>
              {date(current.recorded_at)}
            </time>
          </div>
          <div className="profile-plot">
            <div className="profile-chart-axis">
              {[1, 0.5, 0].map((part) => (
                <span key={part}>
                  {Math.round(
                    metric === "rank"
                      ? lower + (1 - part) * (upper - lower)
                      : lower + part * (upper - lower),
                  ).toLocaleString()}
                </span>
              ))}
            </div>
            <svg
              viewBox="0 0 720 192"
              preserveAspectRatio="none"
              role="img"
              aria-label={`${name}'s ${metric === "rating" ? "power rating" : "global rank"} history`}
              onPointerMove={(event) => {
                if (rows.length < 2) return;
                const rect = event.currentTarget.getBoundingClientRect();
                setSelected(
                  Math.max(
                    0,
                    Math.min(
                      rows.length - 1,
                      Math.round(
                        ((event.clientX - rect.left) / rect.width) *
                          (rows.length - 1),
                      ),
                    ),
                  ),
                );
              }}
              onPointerLeave={() => setSelected(null)}
            >
              <defs>
                <linearGradient
                  id="profile-chart-fill"
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor="#e0e0e0" stopOpacity=".14" />
                  <stop offset="100%" stopColor="#e0e0e0" stopOpacity="0" />
                </linearGradient>
              </defs>
              {[20, 96, 172].map((line) => (
                <line
                  x1="0"
                  y1={line}
                  x2="720"
                  y2={line}
                  stroke="#ffffff10"
                  strokeDasharray="3 6"
                  key={line}
                />
              ))}
              {rows.length > 1 && (
                <>
                  <polygon
                    points={`${x(0)},192 ${points} ${x(rows.length - 1)},192`}
                    fill="url(#profile-chart-fill)"
                  />
                  <polyline
                    points={points}
                    fill="none"
                    stroke="#d6d6d6"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                    strokeLinejoin="round"
                  />
                </>
              )}
              <line
                x1={x(index)}
                y1="10"
                x2={x(index)}
                y2="184"
                stroke="#ffffff28"
                strokeDasharray="3 4"
              />
              <circle
                cx={x(index)}
                cy={y(index)}
                r="4"
                fill="#f5f5f5"
                stroke="#161616"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
          <input
            className="profile-history-scrubber"
            type="range"
            min="0"
            max={rows.length - 1}
            value={index}
            disabled={rows.length === 1}
            onChange={(event) => setSelected(Number(event.target.value))}
            aria-label="Inspect performance history"
            aria-valuetext={`${date(current.recorded_at)}: ${valueText(current)}, ${current.event_label}`}
          />
          <div className="profile-chart-dates">
            <span>
              {date(rows[0].recorded_at, { month: "short", day: "numeric" })}
            </span>
            <span>
              {rows.length === 1
                ? "First record"
                : `${rows.length} rating updates`}
            </span>
            <span>
              {date(rows[rows.length - 1].recorded_at, {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </>
      ) : (
        <div className="profile-empty">
          <Activity size={25} />
          <h3>No rating history yet.</h3>
          <p>Your first recorded result will start the graph.</p>
        </div>
      )}
    </section>
  );
}

function Milestones({ player }: { player: PlayerDetail }) {
  const milestones = [
    {
      name: "On the frontier",
      detail: "Registered player",
      unlocked: true,
      Icon: BadgeCheck,
    },
    {
      name: "First victory",
      detail: "Win a verified match",
      unlocked: player.wins >= 1,
      Icon: Target,
    },
    {
      name: "Battle tested",
      detail: "Play 10 matches",
      unlocked: player.wins + player.losses >= 10,
      Icon: Swords,
    },
    {
      name: "Ten victories",
      detail: "Win 10 matches",
      unlocked: player.wins >= 10,
      Icon: Medal,
    },
    {
      name: "Outlaw",
      detail: "Reach 1,700 PR",
      unlocked: player.peak_rating >= 1700,
      Icon: Crosshair,
    },
    {
      name: "Legend",
      detail: "Reach 1,900 PR",
      unlocked: player.peak_rating >= 1900,
      Icon: Trophy,
    },
  ];
  return (
    <section className="profile-panel">
      <div className="profile-section-title">
        <div>
          <h2>Milestones</h2>
          <p>Earned through your recorded career.</p>
        </div>
        <span className="profile-count-label">
          {milestones.filter((item) => item.unlocked).length} /{" "}
          {milestones.length}
        </span>
      </div>
      <ul className="profile-milestones">
        {milestones.map(({ name, detail, unlocked, Icon }) => (
          <li key={name} className={unlocked ? "unlocked" : "locked"}>
            <span className="profile-medal">
              <Icon size={25} />
            </span>
            <strong>{name}</strong>
            <small>{detail}</small>
            <span className="profile-milestone-status">
              {unlocked ? (
                <>
                  <Check size={11} />
                  Unlocked
                </>
              ) : (
                "Locked"
              )}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
