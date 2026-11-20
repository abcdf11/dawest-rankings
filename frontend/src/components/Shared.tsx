import { Crosshair, Flame, Minus, Shield, Star, Triangle } from 'lucide-react';
import type { Form, Player } from '../types/rankings';
import { tierLabel } from '../lib/rating';

export function Brand({ small = false }: { small?: boolean }) {
  return <span className={`brand ${small ? 'small' : ''}`}><svg viewBox="0 0 40 40" aria-hidden="true"><path d="m20 2 4.6 10.1L36 10.4l-6.5 9.4 6.2 10-11.4-2L20 38l-4.5-10.2-11.3 2 6.3-10L4 10.4l11.4 1.7Z" fill="currentColor"/><path d="m13 14 7 2 7-2-2 11H15Z" fill="#0d0f12"/><path d="m13 19 7-2 7 2-7 2Z" fill="currentColor"/></svg><span>DAWEST<span className="brand-caption">COMPETITIVE</span></span></span>;
}
export function Sigil({ player, large = false }: { player: Player; large?: boolean }) {
  const variant = player.id % 3;
  return <span className={`sigil ${large ? 'large' : ''}`} style={{ '--player-color': player.accent_color } as React.CSSProperties} aria-hidden="true"><svg viewBox="0 0 100 100"><path className="sigil-frame" d="m50 3 39 22v50L50 97 11 75V25Z"/><path d={variant === 0 ? 'M24 40 36 24 50 30 64 24 76 40 63 49 70 77 50 88 30 77 37 49Z' : variant === 1 ? 'M23 39 35 31 39 17 61 17 66 32 78 39 68 47 68 71 50 85 32 71 32 47Z' : 'M25 25 43 34 50 20 57 34 75 25 70 60 50 84 30 60Z'} fill="currentColor" opacity=".85"/><path d="m32 43 18 6 18-6-8 18H40Z" fill="#17191d"/><path d="m34 46 11 3-2 5-8-3m31-5-11 3 2 5 8-3" fill="currentColor"/><path d="m38 64 12 4 12-4-12 13Z" fill="#17191d"/><path d="M21 38h58" stroke="currentColor" strokeWidth="4"/></svg></span>;
}
export function TierBadge({ tier }: { tier: Player['tier'] }) {
  const Icon = tier === 'LEGEND' ? Star : tier === 'OUTLAW' ? Crosshair : Shield;
  return <span className={`tier-badge ${tier.toLowerCase()}`}><Icon size={12}/>{tierLabel(tier)}</span>;
}
export function Delta({ value }: { value: number }) {
  return <span className={`rank-delta ${value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'}`}>{value === 0 ? <Minus size={12}/> : <><Triangle size={8} fill="currentColor" className={value < 0 ? 'down' : ''}/>{Math.abs(value)}</>}</span>;
}
export function Streak({ value }: { value: number }) { return <span className={`streak ${value > 2 ? 'hot' : value > 0 ? 'positive' : 'muted'}`}>{value > 2 && <Flame size={14}/>} {Math.abs(value)}{value >= 0 ? 'W' : 'L'}</span>; }
export function FormPills({ forms, onOpen }: { forms: Form[]; onOpen?: () => void }) {
  return <span className="form-pills">{forms.slice(0, 5).map((f, index) => <button type="button" key={`${f.id}-${index}`} className={`form-pill ${f.result.toLowerCase()}`} title={`${f.result === 'W' ? 'Win' : 'Loss'} vs ${f.opponent} · ${f.score} · ${f.event}`} aria-label={`${f.result === 'W' ? 'Win' : 'Loss'} against ${f.opponent}, ${f.score}. View player match history`} onClick={event => { if (onOpen) { event.stopPropagation(); onOpen(); } }}>{f.result}</button>)}</span>;
}
