import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { request } from "../lib/api";
import { useSession } from "../hooks/useSession";
import type { EventEntries } from "../types/events";
import { EventTeamList } from "./EventTeamList";

export function EventTeams({ eventId }: { eventId: string }) {
  const client = useQueryClient();
  const session = useSession();
  const base = `/events/${encodeURIComponent(eventId)}/entries/`;
  const entries = useQuery({
    queryKey: ["event-entries", eventId, session.data?.user?.id ?? null],
    queryFn: () => request<EventEntries>(base),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const change = useMutation({
    mutationFn: ({ slug, withdraw }: { slug: string; withdraw: boolean }) =>
      request<EventEntries>(
        withdraw ? `${base}${encodeURIComponent(slug)}/` : base,
        {
          method: withdraw ? "DELETE" : "POST",
          body: withdraw ? undefined : JSON.stringify({ team: slug }),
        },
      ),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["event-entries", eventId] });
      void client.invalidateQueries({ queryKey: ["pickems", eventId] });
      void client.invalidateQueries({ queryKey: ["events"] });
      void client.invalidateQueries({ queryKey: ["event", eventId] });
    },
  });
  const data = entries.data;
  if (!data)
    return (
      <section
        className="event-results event-teams"
        aria-labelledby="event-teams-title"
      >
        <h2 id="event-teams-title">Registered teams</h2>
        {entries.error ? (
          <p className="registration-error" role="alert">
            {entries.error.message}{" "}
            <button
              className="button secondary"
              onClick={() => void entries.refetch()}
            >
              Try again
            </button>
          </p>
        ) : (
          <p role="status">Loading team sign-ups…</p>
        )}
      </section>
    );
  return (
    <section
      className="event-results event-teams"
      aria-labelledby="event-teams-title"
    >
      <div className="pickem-panel-heading">
        <h2 id="event-teams-title">Registered teams</h2>
        <span>
          {data.entries.length} registered ·{" "}
          {data.registration_open ? "Registration open" : "Registration closed"}
        </span>
      </div>
      {data.registration_open &&
        (data.my_teams.length ? (
          <div className="event-team-register">
            {data.my_teams.map((team) => (
              <button
                key={team.slug}
                className={`button ${team.registered ? "secondary" : "primary"}`}
                disabled={change.isPending}
                onClick={() =>
                  change.mutate({ slug: team.slug, withdraw: team.registered })
                }
              >
                {change.isPending && change.variables?.slug === team.slug
                  ? "Saving…"
                  : team.registered
                    ? `Withdraw ${team.name}`
                    : `Register ${team.name}`}
              </button>
            ))}
          </div>
        ) : (
          <p className="registration-help">
            {session.data?.user ? (
              "Faction leaders can register their faction for this event."
            ) : (
              <>
                <a
                  href={`/login?next=${encodeURIComponent(location.pathname)}`}
                >
                  Sign in
                </a>{" "}
                as a faction leader to register your faction.
              </>
            )}
          </p>
        ))}
      {change.error && (
        <p className="registration-error" role="alert">
          {change.error.message}
        </p>
      )}
      {change.isSuccess && (
        <p className="event-registration-success" role="status">
          {change.variables.withdraw
            ? "Your team has been withdrawn."
            : "Your team is signed up for this event."}
        </p>
      )}
      {data.entries.length ? (
        <EventTeamList teams={data.entries} />
      ) : (
        <div className="event-empty">
          <p>No teams registered yet.</p>
        </div>
      )}
    </section>
  );
}
