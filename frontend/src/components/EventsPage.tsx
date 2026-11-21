import { useEffect, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  Clock3,
  LoaderCircle,
  MapPin,
  Search,
  UsersRound,
} from "lucide-react";
import { ApiError, request } from "../lib/api";
import { useSession } from "../hooks/useSession";
import type {
  CompetitionEvent,
  EventDetail,
  EventStatus,
} from "../types/events";
import { Brand } from "./Shared";
import { AccountMenu } from "./AccountMenu";
import { MainNavigation } from "./MainNavigation";

export const eventStatusLabel: Record<EventStatus, string> = {
  UPCOMING: "Upcoming",
  LIVE: "Live",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
};
export const eventDate = (date: string) =>
  new Date(date).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const tabs = ["ALL", "UPCOMING", "LIVE", "PAST"] as const;
type Filter = (typeof tabs)[number];
const inFilter = (event: CompetitionEvent, filter: Filter) =>
  filter === "ALL" ||
  (filter === "PAST"
    ? ["COMPLETED", "CANCELLED"].includes(event.status)
    : event.status === filter);

function Frame({ children }: { children: ReactNode }) {
  return (
    <div className="events-site">
      <header className="site-header">
        <div className="header-inner">
          <a
            className="brand-button"
            href="/"
            aria-label="DaWest rankings home"
          >
            <Brand />
          </a>
          <span className="header-divider" />
          <MainNavigation />
          <div className="header-right">
            <AccountMenu />
          </div>
        </div>
      </header>
      <main className="events-page">{children}</main>
      <footer className="events-footer">DAWEST / EVENTS</footer>
    </div>
  );
}

function EventState({
  error,
  retry,
}: {
  error?: Error | null;
  retry?: () => void;
}) {
  return (
    <div className="event-empty" role={error ? "alert" : "status"}>
      {error ? (
        <>
          <CalendarDays size={30} />
          <h1>
            {error instanceof ApiError && error.status === 404
              ? "Event not found"
              : "Could not load events"}
          </h1>
          <p>{error.message}</p>
          {retry && (
            <button className="button secondary" onClick={retry}>
              Try again
            </button>
          )}
          <a href="/events">View events</a>
        </>
      ) : (
        <>
          <LoaderCircle size={26} className="profile-spinner" />
          <p>Loading events…</p>
        </>
      )}
    </div>
  );
}

function EventCard({ event }: { event: CompetitionEvent }) {
  const date = new Date(event.starts_at);
  return (
    <a className="event-card" href={event.url}>
      <div className="event-calendar">
        <span>{date.toLocaleString(undefined, { month: "short" })}</span>
        <strong>{date.getDate()}</strong>
        <small>{date.getFullYear()}</small>
      </div>
      <div className="event-card-content">
        <div className="event-card-top">
          <span
            className={`event-status event-status-${event.status.toLowerCase()}`}
          >
            {eventStatusLabel[event.status]}
          </span>
          <span>
            {event.format === "SOLO" ? "Solo 1v1" : "Factions"} ·{" "}
            {event.region === "GLOBAL" ? "Global" : event.region}
          </span>
        </div>
        <h2>{event.title}</h2>
        {event.description && <p>{event.description}</p>}
        <div className="event-card-meta">
          <span>
            <Clock3 size={14} />
            <time dateTime={event.starts_at}>{eventDate(event.starts_at)}</time>
          </span>
          <span>
            <MapPin size={14} />
            {event.location}
          </span>
        </div>
      </div>
    </a>
  );
}

export default function EventsPage({ eventId }: { eventId?: string }) {
  const session = useSession();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [search, setSearch] = useState("");
  const [format, setFormat] = useState("ALL");
  const list = useQuery({
    queryKey: ["events"],
    queryFn: () => request<{ events: CompetitionEvent[] }>("/events/"),
    enabled: !eventId,
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 1,
  });
  const detail = useQuery({
    queryKey: ["event", eventId],
    queryFn: () =>
      request<EventDetail>(`/events/${encodeURIComponent(eventId!)}/`),
    enabled: Boolean(eventId),
    retry: false,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
  useEffect(() => {
    const before = document.title;
    document.title = `${detail.data?.title ?? "Events"} · DAWEST`;
    return () => {
      document.title = before;
    };
  }, [detail.data?.title]);
  function tabKeys(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (index + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    setFilter(tabs[next]);
    document.getElementById(`events-tab-${tabs[next]}`)?.focus();
  }
  if (eventId) {
    const event = detail.data;
    return (
      <Frame>
        {detail.isPending ? (
          <EventState />
        ) : detail.error || !event ? (
          <EventState
            error={detail.error}
            retry={() => void detail.refetch()}
          />
        ) : (
          <>
            <div className="event-breadcrumb">
              <a href="/events">Events</a>
              <span>/</span>
              <span>{event.title}</span>
            </div>
            <article className="event-detail">
              <div className="event-detail-heading">
                <span
                  className={`event-status event-status-${event.status.toLowerCase()}`}
                >
                  {eventStatusLabel[event.status]}
                </span>
                <h1>{event.title}</h1>
                <span>
                  {event.format === "SOLO" ? "Solo 1v1" : "Factions"} ·{" "}
                  {event.region === "GLOBAL" ? "Global" : event.region}
                </span>
              </div>
              <div className="event-detail-grid">
                <div className="event-description">
                  {event.description ? (
                    <p>{event.description}</p>
                  ) : (
                    <p>No additional details.</p>
                  )}
                </div>
                <aside className="event-details">
                  <div>
                    <CalendarDays size={18} />
                    <span>
                      Starts
                      <strong>
                        <time dateTime={event.starts_at}>
                          {eventDate(event.starts_at)}
                        </time>
                      </strong>
                    </span>
                  </div>
                  {event.ends_at && (
                    <div>
                      <Clock3 size={18} />
                      <span>
                        Ends
                        <strong>
                          <time dateTime={event.ends_at}>
                            {eventDate(event.ends_at)}
                          </time>
                        </strong>
                      </span>
                    </div>
                  )}
                  <div>
                    <MapPin size={18} />
                    <span>
                      Location<strong>{event.location}</strong>
                    </span>
                  </div>
                  <div>
                    <UsersRound size={18} />
                    <span>
                      Format
                      <strong>
                        {event.format === "SOLO"
                          ? "Solo 1v1"
                          : "Faction matches"}
                      </strong>
                    </span>
                  </div>
                  <p>Times shown in {timeZone}.</p>
                  {event.registration_url &&
                    ["UPCOMING", "LIVE"].includes(event.status) && (
                      <a
                        className="button primary"
                        href={event.registration_url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Registration link
                      </a>
                    )}
                </aside>
              </div>
            </article>
            <section className="event-results">
              <h2>Results</h2>
              {event.matches.length ? (
                event.matches.map((match) => (
                  <div className="event-result" key={match.id}>
                    <a href={match.a.url}>{match.a.name}</a>
                    <strong>
                      {match.score_a} : {match.score_b}
                    </strong>
                    <a href={match.b.url}>{match.b.name}</a>
                    <time dateTime={match.played_at}>
                      {eventDate(match.played_at)}
                    </time>
                  </div>
                ))
              ) : (
                <div className="event-empty">
                  <p>No verified results yet.</p>
                </div>
              )}
            </section>
          </>
        )}
      </Frame>
    );
  }
  const events = list.data?.events ?? [];
  const shown = events.filter(
    (event) =>
      inFilter(event, filter) &&
      (format === "ALL" || event.format === format) &&
      `${event.title} ${event.description} ${event.location} ${event.region}`
        .toLowerCase()
        .includes(search.toLowerCase().trim()),
  );
  return (
    <Frame>
      <div className="events-heading">
        <div>
          <span className="eyebrow">DAWEST</span>
          <h1>Events</h1>
          <p>Event schedules and results.</p>
        </div>
        {session.data?.user?.is_developer && (
          <a className="button secondary" href="/dev#events">
            Manage events
          </a>
        )}
      </div>
      <div className="events-controls">
        <div role="tablist" aria-label="Event status" className="events-tabs">
          {tabs.map((tab, index) => (
            <button
              key={tab}
              role="tab"
              id={`events-tab-${tab}`}
              aria-selected={filter === tab}
              tabIndex={filter === tab ? 0 : -1}
              aria-controls="events-panel"
              onKeyDown={(event) => tabKeys(event, index)}
              onClick={() => setFilter(tab)}
            >
              {tab === "ALL"
                ? "All"
                : tab === "PAST"
                  ? "Past"
                  : eventStatusLabel[tab]}
              <span>
                {events.filter((event) => inFilter(event, tab)).length}
              </span>
            </button>
          ))}
        </div>
        <div className="events-search-row">
          <label className="events-search">
            <Search size={16} />
            <input
              aria-label="Search events"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search events"
            />
          </label>
          <select
            aria-label="Event format"
            value={format}
            onChange={(event) => setFormat(event.target.value)}
          >
            <option value="ALL">All formats</option>
            <option value="SOLO">Solo 1v1</option>
            <option value="FACTION">Factions</option>
          </select>
        </div>
      </div>
      <div
        id="events-panel"
        role="tabpanel"
        aria-labelledby={`events-tab-${filter}`}
      >
        {list.isPending ? (
          <EventState />
        ) : list.error ? (
          <EventState error={list.error} retry={() => void list.refetch()} />
        ) : shown.length ? (
          <div className="events-grid">
            {shown.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        ) : (
          <div className="event-empty">
            <CalendarDays size={30} />
            <h2>
              {search || format !== "ALL"
                ? "No matching events"
                : filter === "ALL"
                  ? "No events yet"
                  : `No ${filter === "PAST" ? "past" : filter.toLowerCase()} events`}
            </h2>
            {search || format !== "ALL" ? (
              <button
                className="button secondary"
                onClick={() => {
                  setSearch("");
                  setFormat("ALL");
                }}
              >
                Clear filters
              </button>
            ) : (
              <p>Published events will appear here.</p>
            )}
          </div>
        )}
      </div>
      <p className="events-timezone">Times shown in {timeZone}.</p>
    </Frame>
  );
}
