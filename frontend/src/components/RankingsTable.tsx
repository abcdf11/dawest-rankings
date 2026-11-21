import { ChevronDown, SearchX } from "lucide-react";
import { motion } from "framer-motion";
import type { RankingEntry, RankingKind } from "../types/rankings";
import { formatRating } from "../lib/rating";
import {
  CompetitorLink,
  Delta,
  FormPills,
  Sigil,
  Streak,
  TierBadge,
} from "./Shared";
export function RankingsTable({
  players,
  onSelect,
  onReset,
  kind = "players",
  emptyLadder = false,
}: {
  players: RankingEntry[];
  onSelect: (p: RankingEntry) => void;
  onReset: () => void;
  kind?: RankingKind;
  emptyLadder?: boolean;
}) {
  if (!players.length)
    return (
      <div className="empty-state">
        <SearchX size={34} />
        <h3>
          {emptyLadder
            ? kind === "teams"
              ? "No registered teams yet"
              : "Be the first on the frontier"
            : kind === "teams"
              ? "No teams found"
              : "No gunslingers found"}
        </h3>
        <p>
          {emptyLadder
            ? kind === "teams"
              ? "Register your crew. Approved teams appear here."
              : "Create a player account to claim your place on the leaderboard."
            : "Try a different name, region, or competitive tier."}
        </p>
        {!emptyLadder && (
          <button className="button secondary" onClick={onReset}>
            Clear filters
          </button>
        )}
        {kind === "players" && (
          <a className="empty-signup-link" href="/signup">
            Create a player account to join the leaderboard
          </a>
        )}
        {emptyLadder && kind === "teams" && (
          <a className="empty-signup-link" href="/register">
            Register a faction
          </a>
        )}
      </div>
    );
  return (
    <div className="table-scroll">
      <table className="rankings-table">
        <thead>
          <tr>
            <th scope="col">
              RANK <ChevronDown size={12} />
            </th>
            <th scope="col">{kind === "teams" ? "TEAM / ROSTER" : "PLAYER"}</th>
            <th scope="col">POWER RATING</th>
            <th scope="col">RECORD</th>
            <th scope="col">STREAK</th>
            <th scope="col">LAST 5</th>
            <th scope="col">
              <span className="sr-only">Profile</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {players.map((player) => (
            <motion.tr
              layout="position"
              transition={{ duration: 0.3 }}
              key={player.id}
              className={player.rank <= 3 ? "top-row" : ""}
              onClick={() => onSelect(player)}
            >
              <td>
                <div className="rank-cell">
                  <span
                    className={
                      player.rank <= 3 ? "rank-value gold" : "rank-value"
                    }
                  >
                    {String(player.rank).padStart(2, "0")}
                  </span>
                  <Delta value={player.rank_delta} />
                </div>
              </td>
              <td>
                <CompetitorLink
                  player={player}
                  className="table-player"
                  onSelect={onSelect}
                >
                  <Sigil player={player} />
                  <span>
                    <strong>{player.display_name}</strong>
                    <span className="player-meta">
                      {"tag" in player
                        ? `${player.tag} · ${player.roster.length} players`
                        : `@${player.username}`}
                      <span className="region-tag">{player.region}</span>
                      {!("tag" in player) && player.team && (
                        <span className="team-affiliation">
                          {player.team.tag}
                        </span>
                      )}
                    </span>
                  </span>
                  <TierBadge tier={player.tier} />
                </CompetitorLink>
              </td>
              <td>
                <div className="rating-cell">
                  <span>
                    {formatRating(player.rating)}
                    <small>PR</small>
                  </span>
                  <span className="strength-track">
                    <span
                      style={{
                        width: `${Math.min(100, (player.rating / 2500) * 100)}%`,
                      }}
                    />
                  </span>
                </div>
              </td>
              <td>
                <div className="record-cell">
                  <span>
                    {player.wins}
                    <i> W</i>
                    <span className="record-separator"> – </span>
                    {player.losses}
                    <i> L</i>
                  </span>
                  <small>{player.win_rate.toFixed(1)}% win rate</small>
                </div>
              </td>
              <td>
                <Streak value={player.current_streak} />
              </td>
              <td>
                <FormPills
                  forms={player.last_five}
                  onOpen={() => onSelect(player)}
                />
              </td>
              <td>
                <span className="row-open">+</span>
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
