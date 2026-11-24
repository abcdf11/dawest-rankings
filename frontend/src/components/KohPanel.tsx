import { Crown } from "lucide-react";
import type { KohSummary } from "../types/rankings";

const when = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const delta = (d: number | null) =>
  d === null ? "Unrated" : `${d > 0 ? "+" : ""}${d.toFixed(1)}`;

/** King of the Hill rounds reported by the DaWest game: kills per round and the Elo they settled. */
export function KohPanel({ koh }: { koh: KohSummary }) {
  return (
    <section className="profile-panel koh-panel" aria-label="King of the Hill">
      <div className="profile-section-title">
        <div>
          <h2>King of the Hill</h2>
          <p>Kills and Elo from in-game KOH rounds.</p>
        </div>
        <Crown size={19} />
      </div>
      <div className="koh-totals">
        <div>
          <span>Kills</span>
          <strong>{koh.kills}</strong>
        </div>
        <div>
          <span>Deaths</span>
          <strong>{koh.deaths}</strong>
        </div>
        <div>
          <span>K/D</span>
          <strong>{koh.kd.toFixed(2)}</strong>
        </div>
        <div>
          <span>Hills won</span>
          <strong>
            {koh.wins}
            <small> / {koh.rounds}</small>
          </strong>
        </div>
      </div>
      <table className="koh-rounds">
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Mode</th>
            <th scope="col">Place</th>
            <th scope="col">Kills</th>
            <th scope="col">Deaths</th>
            <th scope="col">Elo</th>
          </tr>
        </thead>
        <tbody>
          {koh.recent.map((r) => (
            <tr key={r.round_id} className={r.is_winner ? "is-winner" : undefined}>
              <td>
                <time dateTime={r.ended_at}>{when(r.ended_at)}</time>
              </td>
              <td>{r.mode === "SOLO" ? "Solo" : "Faction"}</td>
              <td>
                {r.is_winner ? "King" : `#${r.placement}`}
                <small> of {r.players}</small>
              </td>
              <td>{r.kills}</td>
              <td>{r.deaths}</td>
              <td
                className={
                  r.rating_delta === null
                    ? "koh-unrated"
                    : r.rating_delta >= 0
                      ? "koh-gain"
                      : "koh-loss"
                }
              >
                {delta(r.rating_delta)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
