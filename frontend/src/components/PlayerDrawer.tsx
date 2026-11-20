import { useQuery } from "@tanstack/react-query";
import { Activity, Crosshair, TrendingUp, Trophy } from "lucide-react";
import type {
  Ladder,
  Player,
  RankingEntry,
  RankingKind,
} from "../types/rankings";
import { getPlayer } from "../lib/api";
import { formatRating } from "../lib/rating";
import { Modal } from "./Modal";
import { Delta, Sigil, TierBadge } from "./Shared";
export function PlayerDrawer({
  player,
  source,
  onClose,
  kind = "players",
  onSelectPlayer,
}: {
  player: RankingEntry;
  source: Ladder["source"];
  onClose: () => void;
  kind?: RankingKind;
  onSelectPlayer?: (player: Player) => void;
}) {
  const { data, isError, refetch } = useQuery({
    queryKey: [kind === "teams" ? "team" : "player", player.username, source],
    queryFn: () => getPlayer(player, source, kind),
  });
  const p = data ?? player;
  const team = "roster" in p ? p : null;
  const history = data?.history ?? [];
  const min = Math.min(...history.map((h) => h.rating)) - 15,
    max = Math.max(...history.map((h) => h.rating)) + 15;
  const points = history
    .map(
      (h, i) =>
        `${20 + (i / Math.max(1, history.length - 1)) * 460},${160 - ((h.rating - min) / (max - min)) * 130}`,
    )
    .join(" ");
  return (
    <Modal
      title={kind === "teams" ? "TEAM PROFILE" : "PLAYER PROFILE"}
      onClose={onClose}
      drawer
    >
      <div className={`drawer-identity${team ? " team-identity" : ""}`}>
        <Sigil player={p} large />
        <div>
          <TierBadge tier={p.tier} />
          <h2>{p.display_name}</h2>
          <p>
            {team ? team.tag : `@${p.username}`}{" "}
            <span className="region-tag">{p.region}</span>
          </p>
        </div>
      </div>
      {team && (
        <section className="team-roster">
          <div className="section-label">
            <h3>TEAM ROSTER</h3>
            <span>{team.roster.length} players</span>
          </div>
          {team.roster.map((member) => (
            <button
              className="roster-member"
              key={member.id}
              onClick={() => onSelectPlayer?.(member)}
            >
              <Sigil player={member} />
              <span>
                <strong>{member.display_name}</strong>
                <small>
                  #{member.rank} solo · {member.region}
                </small>
              </span>
              <span className="roster-member-rating">
                {formatRating(member.rating)}
                <small>SOLO PR</small>
              </span>
            </button>
          ))}
        </section>
      )}
      <div className="profile-rating">
        <span>
          <small>GLOBAL RANK</small>
          <strong>#{p.rank}</strong>
        </span>
        <span>
          <small>POWER RATING</small>
          <strong className="gold">
            {formatRating(p.rating)}
            <Delta value={p.rank_delta} />
          </strong>
        </span>
      </div>
      <div className="profile-stats">
        <div>
          <Trophy size={18} />
          <small>PEAK RATING</small>
          <strong>{formatRating(p.peak_rating)}</strong>
        </div>
        <div>
          <Crosshair size={18} />
          <small>ROUND K/D</small>
          <strong>{p.kd_ratio.toFixed(2)}</strong>
        </div>
        <div>
          <TrendingUp size={18} />
          <small>WIN RATE</small>
          <strong>{p.win_rate}%</strong>
        </div>
      </div>
      <div className="section-label">
        <h3>RATING TRAJECTORY</h3>
        <span>Recent matches</span>
      </div>
      {history.length > 1 ? (
        <div className="trajectory">
          <svg
            viewBox="0 0 500 190"
            role="img"
            aria-label={`${p.display_name}'s rating history, from ${Math.round(history[0].rating)} to ${Math.round(history[history.length - 1].rating)}`}
          >
            <defs>
              <linearGradient id="chart-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#dddddd" stopOpacity=".24" />
                <stop offset="100%" stopColor="#dddddd" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[40, 90, 140].map((y) => (
              <line
                key={y}
                x1="20"
                y1={y}
                x2="480"
                y2={y}
                stroke="#ffffff12"
                strokeDasharray="4 5"
              />
            ))}
            <polygon
              points={`20,175 ${points} 480,175`}
              fill="url(#chart-fill)"
            />
            <polyline
              points={points}
              fill="none"
              stroke="#dddddd"
              strokeWidth="2.5"
              strokeLinejoin="round"
            />
            {history.map((h, i) => (
              <circle
                key={i}
                cx={20 + (i / Math.max(1, history.length - 1)) * 460}
                cy={160 - ((h.rating - min) / (max - min)) * 130}
                r="3"
                fill="#dddddd"
              >
                <title>
                  {new Date(h.recorded_at).toLocaleDateString()}:{" "}
                  {formatRating(h.rating)} PR · {h.event_label}
                </title>
              </circle>
            ))}
          </svg>
          <div className="chart-labels">
            <span>
              {new Date(history[0].recorded_at).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
            <span>
              {new Date(
                history[history.length - 1].recorded_at,
              ).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
              })}
            </span>
          </div>
        </div>
      ) : (
        <p className="muted">
          {isError
            ? "Could not load rating history."
            : "Loading rating history…"}
        </p>
      )}
      <div className="section-label">
        <h3>{team ? "RECENT TEAM MATCHES" : "RECENT DUELS"}</h3>
        <Activity size={16} />
      </div>
      {isError ? (
        <button className="button secondary" onClick={() => void refetch()}>
          Retry profile
        </button>
      ) : (
        <div className="match-history">
          {data?.matches.map((m) => (
            <div key={m.id} className="match-history-row">
              <span className={`result-box ${m.result.toLowerCase()}`}>
                {m.result}
              </span>
              <span className="match-opponent">
                <strong>vs {m.opponent}</strong>
                <small>{m.event}</small>
              </span>
              <span className="mono">{m.score}</span>
              <span className={`mono ${m.delta > 0 ? "positive" : "negative"}`}>
                {m.delta > 0 ? "+" : ""}
                {m.delta.toFixed(1)}
              </span>
            </div>
          ))}
        </div>
      )}
      <p className="profile-note">
        Registered {team ? "team" : "player"} · Database profile
      </p>
    </Modal>
  );
}
