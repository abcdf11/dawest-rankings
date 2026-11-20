import { ChevronDown, SearchX } from 'lucide-react';
import { motion } from 'framer-motion';
import type { Player } from '../types/rankings';
import { formatRating } from '../lib/rating';
import { Delta, FormPills, Sigil, Streak, TierBadge } from './Shared';
export function RankingsTable({ players, onSelect, onReset }: { players: Player[]; onSelect: (p: Player) => void; onReset: () => void }) {
  if (!players.length) return <div className="empty-state"><SearchX size={34}/><h3>No gunslingers found</h3><p>Try a different name, region, or competitive tier.</p><button className="button secondary" onClick={onReset}>Clear filters</button></div>;
  return <div className="table-scroll"><table className="rankings-table"><thead><tr><th scope="col">RANK <ChevronDown size={12}/></th><th scope="col">PLAYER</th><th scope="col">POWER RATING</th><th scope="col">RECORD</th><th scope="col">STREAK</th><th scope="col">LAST 5</th><th scope="col"><span className="sr-only">Profile</span></th></tr></thead><tbody>{players.map(player => <motion.tr layout="position" transition={{ duration: .3 }} key={player.id} className={player.rank <= 3 ? 'top-row' : ''} onClick={() => onSelect(player)}>
    <td><div className="rank-cell"><span className={player.rank <= 3 ? 'rank-value gold' : 'rank-value'}>{String(player.rank).padStart(2, '0')}</span><Delta value={player.rank_delta}/></div></td>
    <td><button className="table-player" onClick={event => { event.stopPropagation(); onSelect(player); }}><Sigil player={player}/><span><strong>{player.display_name}</strong><span className="player-meta">@{player.username}<span className="region-tag">{player.region}</span></span></span><TierBadge tier={player.tier}/></button></td>
    <td><div className="rating-cell"><span>{formatRating(player.rating)}<small>PR</small></span><span className="strength-track"><span style={{ width: `${Math.min(100, player.rating / 2500 * 100)}%` }}/></span></div></td>
    <td><div className="record-cell"><span>{player.wins}<i> W</i><span className="record-separator"> – </span>{player.losses}<i> L</i></span><small>{player.win_rate.toFixed(1)}% win rate</small></div></td>
    <td><Streak value={player.current_streak}/></td><td><FormPills forms={player.last_five} onOpen={() => onSelect(player)}/></td><td><span className="row-open">+</span></td>
  </motion.tr>)}</tbody></table></div>;
}
