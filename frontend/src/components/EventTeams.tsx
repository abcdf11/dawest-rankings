import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, UsersRound } from "lucide-react";
import { request } from "../lib/api";
import { useSession } from "../hooks/useSession";
import type { EventEntries } from "../types/events";
import { EventTeamList } from "./EventTeamList";

export function EventTeams({ eventId }: { eventId: string }) {
  const client = useQueryClient();
  const session = useSession();
  const [selected, setSelected] = useState("");
  const base = `/events/${encodeURIComponent(eventId)}/entries/`;
  const key = ["event-entries", eventId, session.data?.user?.id ?? null];
  const entries = useQuery({
    queryKey: key,
    queryFn: () => request<EventEntries>(base),
    enabled: !session.isPending,
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const change = useMutation({
    mutationFn: ({ slug, withdraw }: { slug: string; name: string; withdraw: boolean }) =>
      request<EventEntries>(
        withdraw ? `${base}${encodeURIComponent(slug)}/` : base,
        {
          method: withdraw ? "DELETE" : "POST",
          body: withdraw ? undefined : JSON.stringify({ team: slug }),
        },
      ),
    onSuccess: (next) => {
      client.setQueryData(key, next);
      for (const queryKey of [["pickems", eventId], ["events"], ["event", eventId]]) {
        void client.invalidateQueries({ queryKey });
      }
    },
    onError: () => void client.invalidateQueries({ queryKey: ["event-entries", eventId] }),
  });
  const data = entries.data;
  const restricted = session.data?.user?.player?.is_restricted === true;
  const available = data?.my_teams.filter((team) => !team.registered) ?? [];
  const registered = data?.my_teams.filter((team) => team.registered) ?? [];
  const chosen = available.find((team) => team.slug === selected) ?? available[0];
  const registrationUrl = `/events/${encodeURIComponent(eventId)}#faction-registration`;

  return (
    <>
      <section
        id="faction-registration"
        className="event-faction-registration"
        aria-labelledby="faction-registration-title"
      >
        <div className="event-registration-heading">
          <UsersRound size={24} aria-hidden />
          <div>
            <h2 id="faction-registration-title">Faction registration</h2>
            <p>Enter a faction you lead into this event. Sign-ups close when the event starts.</p>
          </div>
          {data && <span className={`event-registration-state${data.registration_open ? " is-open" : ""}`}>
            {data.registration_open ? "Registration open" : "Registration closed"}
          </span>}
        </div>
        {!data ? (
          entries.error ? (
            <p className="registration-error" role="alert">
              {entries.error.message}{" "}
              <button type="button" className="button secondary" onClick={() => void entries.refetch()}>Try again</button>
            </p>
          ) : <p role="status">Loading faction registration…</p>
        ) : (
          <>
            {registered.length > 0 && (
              <ul className="event-my-entries" aria-label="Your registered factions">
                {registered.map((team) => (
                  <li key={team.slug}>
                    <div>
                      <CheckCircle2 size={18} aria-hidden />
                      <a href={team.url}>{team.name}</a>
                      <span>Registered</span>
                    </div>
                    {data.registration_open && (
                      <button
                        type="button"
                        className="button secondary"
                        disabled={change.isPending}
                        onClick={() => change.mutate({ slug: team.slug, name: team.name, withdraw: true })}
                      >
                        {change.isPending && change.variables?.slug === team.slug ? "Withdrawing…" : `Withdraw ${team.name}`}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!data.registration_open ? (
              <p className="registration-help">Registration is closed for this event. Contact a developer if your faction needs help with an entry.</p>
            ) : !session.data?.authenticated ? (
              <div className="event-registration-prompt">
                <p>Sign in as a faction leader to register your faction.</p>
                <a className="button primary" href={`/login?next=${encodeURIComponent(registrationUrl)}`}>Sign in to register</a>
              </div>
            ) : restricted ? (
              <p className="registration-error" role="alert">Your account is restricted. Contact a developer before registering a faction.</p>
            ) : data.my_teams.length === 0 ? (
              <div className="event-registration-prompt">
                <p>Only faction leaders can register. Your faction must be approved before it can enter an event.</p>
                <a className="button secondary" href="/factions">Your factions</a>
                <a className="button secondary" href="/register">Register a new faction</a>
              </div>
            ) : chosen ? (
              <form
                className="event-faction-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!change.isPending) change.mutate({ slug: chosen.slug, name: chosen.name, withdraw: false });
                }}
              >
                <label htmlFor="event-registration-faction">Choose your faction</label>
                <div>
                  <select
                    id="event-registration-faction"
                    value={chosen.slug}
                    onChange={(event) => setSelected(event.target.value)}
                    disabled={change.isPending}
                  >
                    {available.map((team) => <option key={team.slug} value={team.slug}>{team.name} [{team.tag}]</option>)}
                  </select>
                  <button className="button primary" type="submit" disabled={change.isPending}>
                    {change.isPending ? "Registering…" : "Register faction"}
                  </button>
                </div>
              </form>
            ) : (
              <p className="registration-help">All your factions are registered for this event.</p>
            )}
            {change.error && <p className="registration-error" role="alert">{change.error.message}</p>}
            {change.isSuccess && (
              <p className="event-registration-success" role="status">
                {change.variables.withdraw
                  ? `${change.variables.name} has been withdrawn.`
                  : `${change.variables.name} is registered for this event.`}
              </p>
            )}
          </>
        )}
      </section>
      {data && (
        <section className="event-results event-teams" aria-labelledby="event-teams-title">
          <div className="pickem-panel-heading">
            <h2 id="event-teams-title">Registered teams</h2>
            <span>{data.entries.length} registered</span>
          </div>
          {data.entries.length ? <EventTeamList teams={data.entries} /> : (
            <div className="event-empty"><p>No teams registered yet.</p></div>
          )}
        </section>
      )}
    </>
  );
}
