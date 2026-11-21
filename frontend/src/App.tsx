import { useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence } from "framer-motion";
import {
  Activity,
  Check,
  ChevronDown,
  CircleHelp,
  Crosshair,
  Globe2,
  Info,
  ListOrdered,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Swords,
  Trophy,
  X,
  UsersRound,
  UserRound,
} from "lucide-react";
import type {
  Player,
  RankingEntry,
  RankingKind,
  Region,
  Tier,
} from "./types/rankings";
import { getLadder, officialMode } from "./lib/api";
import { useRankingsSocket } from "./hooks/useRankingsSocket";
import { Brand } from "./components/Shared";
import { PodiumHero } from "./components/PodiumHero";
import { RankingsTable } from "./components/RankingsTable";
import { PlayerDrawer } from "./components/PlayerDrawer";
import { MatchSimulator } from "./components/MatchSimulator";
import { CustomRankBuilder } from "./components/CustomRankBuilder";
import { Modal } from "./components/Modal";
import { FrontierHero } from "./components/FrontierHero";
import { AccountMenu } from "./components/AccountMenu";
import {
  LoadingScreen,
  INTRO_STORAGE_KEY,
  shouldShowIntro,
} from "./components/LoadingScreen";
import { factionUrl, profileUrl } from "./lib/profile";

type Mode = "rankings" | "simulator" | "builder";
export default function App() {
  const [showIntro, setShowIntro] = useState(shouldShowIntro);
  const [introKey, setIntroKey] = useState(0);
  const finishIntro = useCallback(() => {
    try {
      sessionStorage.setItem(INTRO_STORAGE_KEY, "1");
    } catch {
      /* Storage may be disabled; the intro still closes. */
    }
    setShowIntro(false);
  }, []);
  function replayIntro() {
    setIntroKey((key) => key + 1);
    setShowIntro(true);
  }
  const [kind, setKind] = useState<RankingKind>(() =>
    new URLSearchParams(window.location.search).get("ranking") === "teams"
      ? "teams"
      : "players",
  );
  const isTeams = kind === "teams";
  const noun = isTeams ? "teams" : "gunslingers";
  const [mode, setMode] = useState<Mode>(() =>
    window.location.hash.includes("list=") ? "builder" : "rankings",
  );
  const [tier, setTier] = useState<Tier | "ALL">("ALL"),
    [region, setRegion] = useState<Region | "ALL">("ALL");
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState("rating"),
    [limit, setLimit] = useState(10);
  const [selected, setSelected] = useState<RankingEntry | null>(null),
    [help, setHelp] = useState(false);
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ["rankings", kind],
    queryFn: () => getLadder(kind),
    staleTime: 30_000,
    refetchInterval: officialMode ? 60_000 : false,
    retry: 1,
  });
  const players = data?.players ?? [];
  const { connected, matches } = useRankingsSocket(
    data?.source === "official" && data.realtime_enabled !== false,
    kind,
  );
  const closeDrawer = useCallback(() => setSelected(null), []),
    closeHelp = useCallback(() => setHelp(false), []);
  const filtered = useMemo(
    () =>
      players
        .filter(
          (p) =>
            (tier === "ALL" || p.tier === tier) &&
            (region === "ALL" || p.region === region) &&
            `${p.display_name} ${p.username} ${"tag" in p ? p.tag : ""}`
              .toLowerCase()
              .includes(search.toLowerCase().trim()),
        )
        .sort(
          (a, b) =>
            (sort === "win"
              ? b.win_rate - a.win_rate
              : sort === "streak"
                ? b.current_streak - a.current_streak
                : sort === "peak"
                  ? b.peak_rating - a.peak_rating
                  : b.rating - a.rating) || a.rank - b.rank,
        ),
    [players, tier, region, search, sort],
  );
  function reset() {
    setTier("ALL");
    setRegion("ALL");
    setSearch("");
    setSort("rating");
    setLimit(10);
  }
  function changeKind(next: RankingKind) {
    if (next === kind) return;
    const url = new URL(window.location.href);
    url.searchParams.set("ranking", next);
    url.hash = "";
    window.history.replaceState(null, "", url);
    setKind(next);
    setSelected(null);
    reset();
  }
  function openRosterPlayer(player: Player) {
    window.location.assign(profileUrl(player.username));
  }
  function openCompetitor(player: RankingEntry) {
    window.location.assign(
      "tag" in player
        ? factionUrl(player.username)
        : profileUrl(player.username),
    );
  }
  const latestEntry = players
    .flatMap((player) => player.last_five.map((match) => ({ player, match })))
    .sort(
      (a, b) => Date.parse(b.match.played_at) - Date.parse(a.match.played_at),
    )[0];
  const latest = latestEntry?.match;
  const sourceLabel = connected ? "LIVE RANKINGS" : "REGISTERED LADDER";
  return (
    <>
      <AnimatePresence>
        {showIntro && (
          <LoadingScreen
            key={introKey}
            ready={!isPending}
            onComplete={finishIntro}
          />
        )}
      </AnimatePresence>
      <div
        className="app-shell"
        inert={showIntro}
        aria-hidden={showIntro || undefined}
      >
        <header className="site-header">
          <div className="header-inner">
            <button
              className="brand-button"
              aria-label="DaWest rankings home"
              onClick={() => setMode("rankings")}
            >
              <Brand />
            </button>
            <span className="header-divider" />
            <nav aria-label="Main navigation">
              <a href="/factions">Factions</a>
              <button
                className={mode === "rankings" ? "active" : ""}
                onClick={() => setMode("rankings")}
              >
                Power rankings
              </button>
              <button
                className={mode === "simulator" ? "active" : ""}
                onClick={() => setMode("simulator")}
              >
                Match simulator
              </button>
              <button
                className={mode === "builder" ? "active" : ""}
                onClick={() => setMode("builder")}
              >
                My tier list<span className="new-tag">NEW</span>
              </button>
            </nav>
            <div className="header-right">
              <AccountMenu />
              <span className="season-badge">
                SEASON <b>04</b>
              </span>
              <button
                className="icon-button help-button"
                title="How rankings work"
                aria-label="How rankings work"
                onClick={() => setHelp(true)}
              >
                <CircleHelp size={19} />
              </button>
            </div>
          </div>
        </header>
        <main className={isTeams ? "team-ladder" : "player-ladder"}>
          <FrontierHero
            isTeams={isTeams}
            total={data?.total}
            onReplay={replayIntro}
            animate={!showIntro}
          />
          <div className="content-wrap">
            <div
              className="ranking-kind-switch"
              role="group"
              aria-label="Ranking category"
            >
              <button
                aria-label="Player rankings"
                aria-pressed={!isTeams}
                className={!isTeams ? "active" : ""}
                onClick={() => changeKind("players")}
              >
                <UserRound size={20} />
                <span>
                  <strong>PLAYERS</strong>
                  <small>Solo 1v1 rankings</small>
                </span>
              </button>
              <button
                aria-label="Team rankings"
                aria-pressed={isTeams}
                className={isTeams ? "active" : ""}
                onClick={() => changeKind("teams")}
              >
                <UsersRound size={22} />
                <span>
                  <strong>TEAMS</strong>
                  <small>Team circuit rankings</small>
                </span>
              </button>
              <p>Two ladders. One frontier.</p>
              <a href="/register" className="register-team-link">
                <UsersRound size={15} />
                Register a faction
              </a>
            </div>
            <div className="page-heading">
              <div>
                <span className="eyebrow muted">
                  {isTeams
                    ? "THE TEAM COMPETITIVE LADDER"
                    : "THE SOLO COMPETITIVE LADDER"}
                </span>
                <h2>
                  {isTeams ? "TEAM POWER RANKINGS" : "POWER RANKINGS"}
                  <span className="heading-slice" aria-hidden="true">
                    //
                  </span>
                </h2>
              </div>
              <div className="ranking-status">
                <span className={`sync-label ${connected ? "is-live" : ""}`}>
                  <span className="status-dot" />
                  {isFetching && !isPending ? "UPDATING" : sourceLabel}
                </span>
                <span className="last-updated">
                  {data
                    ? `Updated ${new Date(data.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                    : "Connecting to the frontier"}
                </span>
              </div>
            </div>
            <div
              className="mode-tabs"
              role="tablist"
              aria-label="Ranking modes"
            >
              <button
                role="tab"
                aria-selected={mode === "rankings"}
                className={mode === "rankings" ? "active" : ""}
                onClick={() => setMode("rankings")}
              >
                <Trophy size={15} />
                Official ladder
              </button>
              <button
                role="tab"
                aria-selected={mode === "simulator"}
                className={mode === "simulator" ? "active" : ""}
                onClick={() => setMode("simulator")}
              >
                <Swords size={16} />
                What-if simulator
              </button>
              <button
                role="tab"
                aria-selected={mode === "builder"}
                className={mode === "builder" ? "active" : ""}
                onClick={() => setMode("builder")}
              >
                <ListOrdered size={16} />
                Community tier list
              </button>
              <button
                className="methodology-link"
                onClick={() => setHelp(true)}
              >
                <Info size={14} /> How it works
              </button>
            </div>
            {isPending ? (
              <div className="loading-state">
                <Crosshair className="loading-spin" size={30} />
                <h3>SCOUTING THE FRONTIER</h3>
                <p>Loading the competitive ladder…</p>
              </div>
            ) : isError ? (
              <div className="empty-state">
                <Activity size={32} />
                <h3>The ladder is temporarily unavailable</h3>
                <p>
                  We couldn’t reach the rankings service. Your filters are
                  saved.
                </p>
                <button
                  className="button primary"
                  onClick={() => void refetch()}
                >
                  Reconnect
                </button>
              </div>
            ) : (
              data && (
                <>
                  {mode === "rankings" ? (
                    <>
                      <div className="spotlight-heading">
                        <span>
                          <span className="gold-dot" />
                          FRONTIER’S FINEST
                        </span>
                        <span>THE TOP THREE</span>
                      </div>
                      <PodiumHero players={players} onSelect={openCompetitor} />
                      <div className="ladder-controls">
                        <div
                          className="tier-filters"
                          aria-label="Filter by competitive tier"
                        >
                          {(
                            [
                              "ALL",
                              "LEGEND",
                              "OUTLAW",
                              "GUNSLINGER",
                              "DEPUTY",
                              "ROOKIE",
                            ] as const
                          ).map((t) => (
                            <button
                              key={t}
                              aria-pressed={tier === t}
                              onClick={() => {
                                setTier(t);
                                setLimit(10);
                              }}
                              className={tier === t ? "active" : ""}
                            >
                              {t === "ALL"
                                ? isTeams
                                  ? "ALL TEAMS"
                                  : "ALL PLAYERS"
                                : t}
                              {t === "ALL" && <span>{players.length}</span>}
                            </button>
                          ))}
                        </div>
                        <div className="filter-bottom">
                          <label className="search-field">
                            <Search size={16} />
                            <input
                              aria-label={
                                isTeams ? "Search teams" : "Search players"
                              }
                              placeholder={
                                isTeams
                                  ? "Search a team or tag…"
                                  : "Search a gunslinger…"
                              }
                              value={search}
                              onChange={(e) => {
                                setSearch(e.target.value);
                                setLimit(10);
                              }}
                            />
                            {search && (
                              <button
                                className="icon-button"
                                aria-label="Clear search"
                                onClick={() => setSearch("")}
                              >
                                <X size={14} />
                              </button>
                            )}
                          </label>
                          <div className="select-field">
                            <Globe2 size={15} />
                            <select
                              aria-label="Filter by region"
                              value={region}
                              onChange={(e) => {
                                setRegion(e.target.value as Region | "ALL");
                                setLimit(10);
                              }}
                            >
                              <option value="ALL">All regions</option>
                              <option value="NA">North America</option>
                              <option value="EU">Europe</option>
                              <option value="ASIA">Asia</option>
                              <option value="SA">South America</option>
                              <option value="OCE">Oceania</option>
                            </select>
                          </div>
                          <div className="sort-field">
                            <SlidersHorizontal size={14} />
                            <span>Sort by:</span>
                            <select
                              aria-label={
                                isTeams ? "Sort teams" : "Sort players"
                              }
                              value={sort}
                              onChange={(e) => setSort(e.target.value)}
                            >
                              <option value="rating">Power rating</option>
                              <option value="win">Win percentage</option>
                              <option value="streak">Hot streak</option>
                              <option value="peak">Peak rating</option>
                            </select>
                          </div>
                        </div>
                      </div>
                      <RankingsTable
                        emptyLadder={data.total === 0}
                        kind={kind}
                        players={filtered.slice(0, limit)}
                        onSelect={openCompetitor}
                        onReset={reset}
                      />
                      <div className="table-footer">
                        <span>
                          Showing <b>{Math.min(limit, filtered.length)}</b> of{" "}
                          <b>{filtered.length}</b> {noun}
                          {tier !== "ALL" || region !== "ALL" || search ? (
                            <button onClick={reset}>Clear filters</button>
                          ) : null}
                        </span>
                        {filtered.length > limit ? (
                          <button
                            className="show-more"
                            onClick={() => setLimit((old) => old + 10)}
                          >
                            Show more {isTeams ? "teams" : "players"}{" "}
                            <ChevronDown size={14} />
                          </button>
                        ) : (
                          filtered.length > 10 && (
                            <button
                              className="show-more"
                              onClick={() => setLimit(10)}
                            >
                              Show top 10
                            </button>
                          )
                        )}
                        <span className="verified-note">
                          <Check size={13} />
                          Registered competition data
                        </span>
                      </div>
                      <div className="bottom-panels">
                        <div className="latest-result">
                          <span className="mini-icon">
                            <Swords size={19} />
                          </span>
                          <div>
                            <span className="eyebrow">
                              {matches.length
                                ? "LIVE DUEL"
                                : "LATEST RECORDED DUEL"}
                            </span>
                            {matches[0] ? (
                              <p>
                                {matches[0].player_a}{" "}
                                <b>
                                  {matches[0].score_a} : {matches[0].score_b}
                                </b>{" "}
                                {matches[0].player_b}
                              </p>
                            ) : latest ? (
                              <p>
                                {latestEntry.player.display_name}{" "}
                                <b>{latest.score}</b> {latest.opponent}
                                <span>{latest.event}</span>
                              </p>
                            ) : (
                              <p>No completed matches yet</p>
                            )}
                          </div>
                        </div>
                        <button
                          className="build-promo"
                          onClick={() => setMode("builder")}
                        >
                          <ListOrdered size={22} />
                          <span>
                            <strong>Your frontier. Your order.</strong>
                            <small>
                              Build and share your own power rankings.
                            </small>
                          </span>
                          <span className="promo-label">MAKE YOUR LIST</span>
                        </button>
                      </div>
                    </>
                  ) : mode === "simulator" ? (
                    <MatchSimulator
                      key={kind}
                      players={players}
                      source={data.source}
                      kind={kind}
                    />
                  ) : (
                    <CustomRankBuilder
                      key={kind}
                      players={players}
                      kind={kind}
                    />
                  )}
                  <div className="data-note">
                    <Info size={13} />
                    Only registered player accounts and approved teams appear.
                    Rankings update after verified match results.
                  </div>
                </>
              )
            )}
          </div>
        </main>
        <footer className="site-footer">
          <Brand small />
          <span>EVERY DUEL COUNTS.</span>
          <div>
            <button onClick={() => setHelp(true)}>Ranking methodology</button>
            <span>© 2026 DAWEST RANKINGS</span>
          </div>
        </footer>
        <AnimatePresence>
          {selected && (
            <PlayerDrawer
              kind={kind}
              player={players.find((p) => p.id === selected.id) ?? selected}
              source={data?.source ?? "official"}
              onClose={closeDrawer}
              onSelectPlayer={openRosterPlayer}
            />
          )}
          {help && (
            <Modal title="RANKING METHODOLOGY" onClose={closeHelp}>
              <div className="methodology">
                <span className="icon-square">
                  <Crosshair size={25} />
                </span>
                <h2>EVERY DUEL COUNTS.</h2>
                <p>
                  {isTeams
                    ? "Team power ratings measure verified team match results. Roster members keep their independent solo ratings. Beat stronger teams, win decisively, and rise together."
                    : "Your power rating measures individual performance. Beat stronger opponents, win decisively, and rise through the frontier."}
                </p>
                <div className="method-row">
                  <strong>
                    01 <span>Strength of opponent</span>
                  </strong>
                  <p>
                    Expected win chance follows Elo: 1 ÷ (1 + 10^((opponent
                    rating − your rating) ÷ 400)). Upsets earn more points.
                  </p>
                </div>
                <div className="method-row">
                  <strong>
                    02 <span>Margin of victory</span>
                  </strong>
                  <p>
                    A 5–0 sweep has more weight than a 5–4 duel. The multiplier
                    is 1 + 0.35 × ln(1 + round difference).
                  </p>
                </div>
                <div className="method-row">
                  <strong>
                    03 <span>The stakes matter</span>
                  </strong>
                  <p>
                    Base K is 32. Ranked duels count 1.0×, showmatches 1.2×,
                    qualifiers 1.25×, and official tournaments 1.5×. Points
                    transfer equally between players.
                  </p>
                </div>
                <div className="tier-guide">
                  {[
                    ["Legend", "1,900+"],
                    ["Outlaw", "1,700–1,899"],
                    ["Gunslinger", "1,500–1,699"],
                    ["Deputy", "1,300–1,499"],
                    ["Rookie", "Under 1,300"],
                  ].map(([name, range]) => (
                    <span key={name}>
                      <strong>{name}</strong>
                      <small>{range} PR</small>
                    </span>
                  ))}
                </div>
                <p className="muted">
                  Rank changes compare the latest verified result. Form runs
                  newest to oldest. Round K/D is rounds won divided by rounds
                  lost. The system uses dynamic Elo.
                </p>
                <button className="button primary" onClick={closeHelp}>
                  Got it
                </button>
              </div>
            </Modal>
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
