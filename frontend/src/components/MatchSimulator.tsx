import { useState } from "react";
import { Crosshair, RotateCcw, Swords, Zap } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import type { Ladder, MatchType, Player, Simulation } from "../types/rankings";
import { simulate } from "../lib/api";
import { formatRating, WEIGHTS } from "../lib/rating";
import { Sigil, TierBadge } from "./Shared";
export function MatchSimulator({
  players,
  source,
}: {
  players: Player[];
  source: Ladder["source"];
}) {
  const [aId, setA] = useState(players[0]?.id ?? 0),
    [bId, setB] = useState(players[1]?.id ?? 0);
  const [scoreA, setScoreA] = useState("5"),
    [scoreB, setScoreB] = useState("2");
  const [type, setType] = useState<MatchType>("RANKED_1V1");
  const mutation = useMutation({
    mutationFn: () =>
      simulate(players, aId, bId, Number(scoreA), Number(scoreB), type, source),
  });
  const a = players.find((p) => p.id === aId),
    b = players.find((p) => p.id === bId);
  function clear() {
    mutation.reset();
  }
  const invalid =
    !a ||
    !b ||
    aId === bId ||
    scoreA === "" ||
    scoreB === "" ||
    Number(scoreA) === Number(scoreB) ||
    ![Number(scoreA), Number(scoreB)].every(
      (v) => Number.isInteger(v) && v >= 0 && v <= 100,
    );
  if (players.length < 2)
    return (
      <div className="empty-state">
        <Swords size={30} />
        <h3>The frontier is waiting</h3>
        <p>At least two ranked players are needed to simulate a duel.</p>
      </div>
    );
  return (
    <section className="mode-panel simulator">
      <div className="mode-header">
        <span className="icon-square">
          <Swords size={22} />
        </span>
        <div>
          <span className="eyebrow gold">PLAY OUT THE POSSIBILITIES</span>
          <h2>WHAT IF THEY DUELED?</h2>
          <p>Set the score. See exactly how the frontier would shift.</p>
        </div>
      </div>
      <div className="duel-grid">
        {[
          {
            p: a,
            id: aId,
            set: setA,
            score: scoreA,
            setScore: setScoreA,
            label: "Challenger",
          },
          {
            p: b,
            id: bId,
            set: setB,
            score: scoreB,
            setScore: setScoreB,
            label: "Opponent",
          },
        ].map(({ p, id, set, score, setScore, label }, i) => (
          <div className="duelist" key={label}>
            <label htmlFor={`player-${i}`}>{label}</label>
            <select
              id={`player-${i}`}
              value={id}
              onChange={(e) => {
                set(Number(e.target.value));
                clear();
              }}
            >
              {players.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.display_name} · #{p.rank}
                </option>
              ))}
            </select>
            {p && (
              <div className="duelist-profile">
                <Sigil player={p} large />
                <h3>{p.display_name}</h3>
                <TierBadge tier={p.tier} />
                <span className="duelist-rating">
                  {formatRating(p.rating)}
                  <small>PR</small>
                </span>
              </div>
            )}
            <label htmlFor={`score-${i}`}>Rounds won</label>
            <input
              id={`score-${i}`}
              className="score-input"
              type="number"
              min="0"
              max="100"
              step="1"
              required
              value={score}
              onChange={(e) => {
                setScore(e.target.value);
                clear();
              }}
            />
          </div>
        ))}
      </div>
      <div className="duel-options">
        <label>
          EVENT TYPE
          <select
            value={type}
            onChange={(e) => {
              setType(e.target.value as MatchType);
              clear();
            }}
          >
            <option value="RANKED_1V1">Ranked 1v1 · 1.0×</option>
            <option value="SHOWMATCH">Showmatch · 1.2×</option>
            <option value="QUALIFIER">Qualifier · 1.25×</option>
            <option value="TOURNAMENT">Official tournament · 1.5×</option>
          </select>
        </label>
        <button
          className="button primary"
          disabled={invalid || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          <Zap size={16} />
          {mutation.isPending ? "Calculating…" : "Simulate duel"}
        </button>
        <button
          className="icon-button"
          title="Reset simulation"
          aria-label="Reset simulation"
          onClick={() => {
            setA(players[0].id);
            setB(players[1].id);
            setScoreA("5");
            setScoreB("2");
            setType("RANKED_1V1");
            clear();
          }}
        >
          <RotateCcw size={17} />
        </button>
      </div>
      {invalid && (
        <p className="validation">
          Choose different players and enter a decisive score from 0 to 100.
        </p>
      )}
      {mutation.isError && (
        <p role="alert" className="negative">
          {mutation.error.message}
        </p>
      )}
      {mutation.data && (
        <SimulationResult result={mutation.data} players={players} />
      )}
      <p className="mode-footnote">
        <Crosshair size={14} /> Dynamic Elo · {WEIGHTS[type]}× event weight ·
        Simulations do not affect the official ladder.
      </p>
    </section>
  );
}
function SimulationResult({
  result,
  players,
}: {
  result: Simulation;
  players: Player[];
}) {
  return (
    <div className="simulation-result" aria-live="polite">
      <div className="section-label">
        <h3>PROJECTED OUTCOME</h3>
        <span>
          {(result.expected_a * 100).toFixed(1)}% pre-match win chance for{" "}
          {players.find((p) => p.id === result.players[0].id)?.display_name}
        </span>
      </div>
      <div className="result-grid">
        {result.players.map((p) => (
          <div key={p.id}>
            <strong>{players.find((x) => x.id === p.id)?.display_name}</strong>
            <span className="result-rating">
              {p.after.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              <small className={p.delta > 0 ? "positive" : "negative"}>
                {p.delta > 0 ? "+" : ""}
                {p.delta.toFixed(2)}
              </small>
            </span>
            <span className="muted">
              Rank #{p.rank_before} → #{p.rank_after}
            </span>
            <TierBadge tier={p.tier} />
          </div>
        ))}
      </div>
    </div>
  );
}
