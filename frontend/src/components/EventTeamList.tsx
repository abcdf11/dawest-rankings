import { UsersRound } from "lucide-react";
import type { EventTeam } from "../types/events";
import { ProfileMediaImage } from "./ProfileMediaImage";

export function EventTeamList({
  teams,
  compact = false,
}: {
  teams: EventTeam[];
  compact?: boolean;
}) {
  return (
    <ul
      className={`event-team-grid${compact ? " compact" : ""}`}
      aria-label="Registered teams"
    >
      {teams.map((team) => (
        <li key={team.slug}>
          <a href={team.url}>
            {team.logo_url ? (
              <ProfileMediaImage
                src={team.logo_url}
                alt=""
                width={36}
                height={36}
                loading="lazy"
              />
            ) : (
              <span className="event-team-logo" aria-hidden="true">
                <UsersRound size={16} />
              </span>
            )}
            <span>
              <b>{team.name}</b>
              <small>[{team.tag}]</small>
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}
