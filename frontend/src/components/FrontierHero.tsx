import { Crosshair, Globe2, Play, ShieldCheck, UsersRound } from "lucide-react";
import { TypewriterText } from "./TypewriterText";

export function FrontierHero({
  isTeams,
  total,
  onReplay,
  animate = true,
}: {
  isTeams: boolean;
  total?: number;
  onReplay: () => void;
  animate?: boolean;
}) {
  return (
    <section className="hero">
      <div className="hero-topline">
        <span>DAWEST / COMPETITIVE INDEX</span>
        <span>SEASON 04 — 2026</span>
      </div>
      <div className="hero-body">
        <div className="hero-content">
          <div className="hero-kicker">
            <span />
            REPUTATION IS EVERYTHING.
          </div>
          <h1 className="vhs-title" data-text="DAWEST" aria-label="DAWEST">
            <TypewriterText text="DAWEST" active={animate} speed={80} />
          </h1>
          <div className="hero-subtitle">
            <TypewriterText
              text="THE POWER INDEX."
              active={animate}
              speed={40}
              delay={650}
            />
          </div>
          <p>
            {isTeams
              ? "Built as a crew. Proven on the frontier."
              : "No backup. No second chances. Make your name."}
            <br />
            The definitive rankings of the West’s best.
          </p>
          <div className="hero-badges">
            <span>
              {isTeams ? <UsersRound size={14} /> : <Crosshair size={14} />}{" "}
              {isTeams ? "TEAM CIRCUIT" : "SOLO 1V1"}
            </span>
            <span>
              <Globe2 size={14} />
              GLOBAL LADDER
            </span>
            <span>
              <ShieldCheck size={14} />
              VERIFIED RESULTS
            </span>
          </div>
        </div>
      </div>
      <div className="hero-bottomline">
        <div className="hero-counters">
          <span>
            <b>{total ?? "—"}</b> RANKED {isTeams ? "TEAMS" : "PLAYERS"}
          </span>
          <span>
            <b>05</b> REGIONS
          </span>
          <span className="hero-season-label">
            ONE FRONTIER. ONE NUMBER ONE.
          </span>
        </div>
        <button onClick={onReplay} className="replay-intro">
          <Play size={12} />
          REPLAY INTRO
        </button>
      </div>
      <span className="frame-corner top-left" />
      <span className="frame-corner top-right" />
      <span className="frame-corner bottom-left" />
      <span className="frame-corner bottom-right" />
    </section>
  );
}
