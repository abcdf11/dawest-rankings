import { Crosshair, Trophy } from "lucide-react";
import { motion } from "framer-motion";
import type { RankingEntry } from "../types/rankings";
import { formatRating } from "../lib/rating";
import { VerifiedFactionBadge } from "./VerifiedFactionBadge";
import {
  CompetitorLink,
  Delta,
  FormPills,
  Sigil,
  Streak,
  TierBadge,
} from "./Shared";
export function PodiumHero({
  players,
  onSelect,
}: {
  players: RankingEntry[];
  onSelect: (p: RankingEntry) => void;
}) {
  return (
    <div className="podium">
      {players.slice(0, 3).map((player, index) => (
        <motion.article
          key={player.id}
          className={`podium-card place-${index + 1}`}
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: index * 0.08 }}
        >
          <div className="podium-top">
            <span className="podium-placement">
              {index === 0 ? <Trophy size={14} /> : <Crosshair size={14} />}{" "}
              RANK {index + 1}
            </span>
            <span className="place-number">0{index + 1}</span>
          </div>
          <CompetitorLink
            player={player}
            className="podium-player"
            onSelect={onSelect}
            label={`View ${player.display_name}'s profile`}
          >
            <Sigil player={player} large />
            <span className="podium-identity">
              <TierBadge tier={player.tier} />
              <span className="player-title">{player.display_name}{"tag" in player && player.is_verified && <VerifiedFactionBadge compact />}</span>
              <span className="player-meta">
                {player.region} <span> / </span>{" "}
                {"tag" in player
                  ? `${player.tag} · ${player.roster.length} players`
                  : `@${player.username}`}
              </span>
            </span>
          </CompetitorLink>
          <div className="podium-bottom">
            <div>
              <span className="rating-label">POWER RATING</span>
              <span className="podium-rating">
                {formatRating(player.rating)}
                <small>PR</small>
                <Delta value={player.rank_delta} />
              </span>
            </div>
            <div className="podium-form">
              <Streak value={player.current_streak} />
              <FormPills
                forms={player.last_five}
                onOpen={() => onSelect(player)}
              />
            </div>
          </div>
        </motion.article>
      ))}
    </div>
  );
}
