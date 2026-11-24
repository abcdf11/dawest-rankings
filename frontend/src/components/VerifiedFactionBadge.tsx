import { BadgeCheck } from "lucide-react";
import "../verified-faction.css";

/** Only render for server-confirmed links to an in-game faction. */
export function VerifiedFactionBadge({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`verified-faction${compact ? " is-compact" : ""}`}
      role="img"
      aria-label="Verified faction"
      title="Verified faction · linked to its in-game Roblox faction"
    >
      <BadgeCheck size={compact ? 16 : 18} aria-hidden />
      {!compact && <span>Verified faction</span>}
    </span>
  );
}
