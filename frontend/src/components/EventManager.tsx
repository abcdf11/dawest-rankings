import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Plus, Trophy } from "lucide-react";
import { request } from "../lib/api";
import type { CompetitionEvent, EventStatus } from "../types/events";
import { eventDate, eventStatusLabel } from "./EventsPage";
import { Modal } from "./Modal";
import { PickemManager } from "./PickemManager";
import { ProfileMediaImage } from "./ProfileMediaImage";

function localDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

export function EventManager() {
  const client = useQueryClient();
  const events = useQuery({
    queryKey: ["developer-events"],
    queryFn: () => request<{ events: CompetitionEvent[] }>("/dev/events/"),
  });
  const [editing, setEditing] = useState<CompetitionEvent | "new" | null>(null);
  const [pickems, setPickems] = useState<CompetitionEvent | null>(null);
  const closePickems = useCallback(() => setPickems(null), []);
  const close = useCallback(() => setEditing(null), []);
  const refresh = () => {
    for (const key of ["developer-events", "events", "event", "developer"])
      void client.invalidateQueries({ queryKey: [key] });
  };
  const publish = useMutation({
    mutationFn: (event: CompetitionEvent) =>
      request(`/dev/events/${event.id}/`, {
        method: "PATCH",
        body: JSON.stringify({ is_published: !event.is_published }),
      }),
    onSuccess: refresh,
  });
  return (
    <section className="dev-events">
      <div className="dev-events-heading">
        <div>
          <h2>Event maker</h2>
          <p>
            Create events, add logos, and manage pick'ems. Players can follow
            published events, and faction leaders can sign up their teams.
          </p>
        </div>
        <button className="button primary" onClick={() => setEditing("new")}>
          <Plus size={15} /> Create event
        </button>
      </div>
      {(events.error || publish.error) && (
        <p className="registration-error" role="alert">
          {events.error?.message || publish.error?.message}
        </p>
      )}
      {events.isPending ? (
        <p role="status">Loading events…</p>
      ) : events.data?.events.length ? (
        <div className="dev-event-list">
          {events.data.events.map((event) => (
            <article key={event.id}>
              <div>
                {event.logo_url && (
                  <ProfileMediaImage
                    className="event-logo dev-event-logo"
                    src={event.logo_url}
                    alt={`${event.title} logo`}
                    width={48}
                    height={48}
                  />
                )}
                <div className="dev-event-labels">
                  <span className="event-status">
                    {eventStatusLabel[event.status]}
                  </span>
                  <span>{event.is_published ? "Published" : "Draft"}</span>
                </div>
                <h3>{event.title}</h3>
                <p>
                  {eventDate(event.starts_at)} ·{" "}
                  {event.format === "SOLO" ? "Solo 1v1" : "Factions"} ·{" "}
                  {event.region}
                  {event.format === "FACTION" &&
                    ` · ${event.team_count ?? 0} teams registered`}
                </p>
              </div>
              <div className="dev-event-actions">
                {event.is_published && (
                  <a href={event.url} className="button secondary">
                    View event
                  </a>
                )}
                <button
                  className="button secondary"
                  onClick={() => setEditing(event)}
                >
                  Edit
                </button>
                <button
                  className="button secondary"
                  onClick={() => setPickems(event)}
                >
                  <Trophy size={15} /> Pick'ems
                </button>
                <button
                  className="button secondary"
                  disabled={publish.isPending}
                  onClick={() => publish.mutate(event)}
                >
                  {event.is_published ? "Unpublish" : "Publish"}
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="event-empty">
          <CalendarDays size={28} />
          <h3>No events yet</h3>
        </div>
      )}
      {pickems && <PickemManager event={pickems} onClose={closePickems} />}
      {editing && (
        <EventEditor
          event={editing === "new" ? undefined : editing}
          onClose={close}
          onSaved={() => {
            refresh();
            close();
          }}
        />
      )}
    </section>
  );
}

function EventEditor({
  event,
  onClose,
  onSaved,
}: {
  event?: CompetitionEvent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState({
    title: event?.title ?? "",
    description: event?.description ?? "",
    format: event?.format ?? "SOLO",
    region: event?.region ?? "GLOBAL",
    location: event?.location ?? "Online",
    starts_at: localDate(event?.starts_at),
    ends_at: localDate(event?.ends_at),
    status: event?.configured_status ?? event?.status ?? "UPCOMING",
    registration_url: event?.registration_url ?? "",
    is_published: event?.is_published ?? false,
  });
  const [logo, setLogo] = useState<File | null>(null);
  const logoInput = useRef<HTMLInputElement>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoPreview, setLogoPreview] = useState("");
  const [logoError, setLogoError] = useState("");
  useEffect(() => {
    if (!logo) {
      setLogoPreview("");
      return;
    }
    const url = URL.createObjectURL(logo);
    setLogoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [logo]);
  const save = useMutation({
    mutationFn: () => {
      const values = {
        ...draft,
        starts_at: new Date(draft.starts_at).toISOString(),
        ends_at: draft.ends_at ? new Date(draft.ends_at).toISOString() : null,
        ...(removeLogo ? { remove_logo: true } : {}),
      };
      let body: string | FormData = JSON.stringify(values);
      if (logo) {
        const form = new FormData();
        for (const [key, value] of Object.entries(values))
          form.set(key, value === null ? "" : String(value));
        form.set("logo", logo);
        body = form;
      }
      return request(
        `/dev/events/${event ? `${event.id}/` : ""}`,
        {
          method: event ? "PATCH" : "POST",
          body,
        },
        30_000,
      );
    },
    onSuccess: onSaved,
  });
  const set = (key: keyof typeof draft, value: string | boolean) => {
    setDraft((draft) => ({ ...draft, [key]: value }));
    save.reset();
  };
  return (
    <Modal
      title={event ? "EDIT EVENT" : "CREATE EVENT"}
      onClose={onClose}
      dismissible={!save.isPending}
    >
      <form
        className="registration-form event-editor"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <fieldset disabled={save.isPending}>
          <label className="registration-field">
            Event title
            <input
              required
              maxLength={120}
              value={draft.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </label>
          <div className="event-logo-editor">
            {(logoPreview || (!removeLogo && event?.logo_url)) && (
              <ProfileMediaImage
                className="event-logo"
                src={logoPreview || event!.logo_url!}
                alt="Event logo preview"
                width={80}
                height={80}
              />
            )}
            <div>
              <label className="registration-field">
                Event logo
                <input
                  ref={logoInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    save.reset();
                    if (
                      file.size > 8 * 1024 * 1024 ||
                      ![
                        "image/png",
                        "image/jpeg",
                        "image/webp",
                        "image/gif",
                      ].includes(file.type)
                    ) {
                      setLogoError(
                        "Choose a PNG, JPG, WebP, or GIF up to 8 MB.",
                      );
                      e.target.value = "";
                      return;
                    }
                    setLogoError("");
                    setLogo(file);
                    setRemoveLogo(false);
                  }}
                />
              </label>
              <p className="event-logo-help">
                PNG, JPG, WebP, or GIF, up to 8 MB. Logos are cropped to a
                square.
              </p>
              {(logo || (!removeLogo && event?.logo_url)) && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setLogo(null);
                    if (logoInput.current) logoInput.current.value = "";
                    setRemoveLogo(true);
                    setLogoError("");
                    save.reset();
                  }}
                >
                  Remove logo
                </button>
              )}
              {removeLogo && event?.logo_url && (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => {
                    setRemoveLogo(false);
                    save.reset();
                  }}
                >
                  Keep existing logo
                </button>
              )}
              {logoError && (
                <p className="registration-error" role="alert">
                  {logoError}
                </p>
              )}
            </div>
          </div>
          <label className="registration-field">
            Description
            <textarea
              rows={4}
              maxLength={3000}
              value={draft.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </label>
          <div className="registration-two-columns">
            <label className="registration-field">
              Format
              <select
                aria-label="Format"
                value={draft.format}
                onChange={(e) => set("format", e.target.value)}
              >
                <option value="SOLO">Solo 1v1</option>
                <option value="FACTION">Factions</option>
              </select>
            </label>
            <label className="registration-field">
              Region
              <select
                aria-label="Region"
                value={draft.region}
                onChange={(e) => set("region", e.target.value)}
              >
                {[
                  ["GLOBAL", "Global"],
                  ["NA", "North America"],
                  ["EU", "Europe"],
                  ["ASIA", "Asia"],
                  ["SA", "South America"],
                  ["OCE", "Oceania"],
                ].map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="registration-two-columns">
            <label className="registration-field">
              Start time
              <input
                required
                type="datetime-local"
                value={draft.starts_at}
                onChange={(e) => set("starts_at", e.target.value)}
              />
            </label>
            <label className="registration-field">
              End time
              <input
                type="datetime-local"
                min={draft.starts_at || undefined}
                value={draft.ends_at}
                onChange={(e) => set("ends_at", e.target.value)}
              />
            </label>
          </div>
          <p className="registration-help">
            Times use {Intl.DateTimeFormat().resolvedOptions().timeZone}. Events
            become live at their start time and completed at their end time.
          </p>
          <label className="registration-field">
            Location
            <input
              required
              maxLength={120}
              value={draft.location}
              onChange={(e) => set("location", e.target.value)}
            />
          </label>
          <label className="registration-field">
            Status
            <select
              aria-label="Status"
              value={draft.status}
              onChange={(e) => set("status", e.target.value as EventStatus)}
            >
              {Object.entries(eventStatusLabel).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="registration-field">
            Registration URL
            <input
              type="url"
              maxLength={500}
              placeholder="https://"
              value={draft.registration_url}
              onChange={(e) => set("registration_url", e.target.value)}
            />
          </label>
          <label className="event-publish">
            <input
              type="checkbox"
              checked={draft.is_published}
              onChange={(e) => set("is_published", e.target.checked)}
            />{" "}
            Publish event
          </label>
        </fieldset>
        {save.error && (
          <p className="registration-error" role="alert">
            {save.error.message}
          </p>
        )}
        <div className="event-editor-actions">
          <button
            type="button"
            className="button secondary"
            disabled={save.isPending}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="button primary"
            disabled={save.isPending || Boolean(logoError)}
          >
            {save.isPending ? "Saving…" : event ? "Save event" : "Create event"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
