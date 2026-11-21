import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Trophy, UsersRound } from "lucide-react";
import { request } from "../lib/api";
import type {
  CompetitionEvent,
  EventTeam,
  PickemMatchup,
  PickemStanding,
  PickSide,
} from "../types/events";
import { eventDate } from "./EventsPage";
import { Modal } from "./Modal";

function localDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

const blank = {
  label: "",
  option_a: "",
  option_b: "",
  team_a: "",
  team_b: "",
  points: "1",
  locks_at: "",
};

export function PickemManager({
  event,
  onClose,
}: {
  event: CompetitionEvent;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const key = ["developer-pickems", event.id];
  const base = `/dev/events/${event.id}/pickems/`;
  const board = useQuery({
    queryKey: key,
    queryFn: () =>
      request<{ matchups: PickemMatchup[]; leaderboard: PickemStanding[] }>(base),
  });
  const faction = event.format === "FACTION";
  const entriesKey = ["developer-event-entries", event.id];
  const entries = useQuery({
    queryKey: entriesKey,
    queryFn: () =>
      request<{ entries: EventTeam[]; available: EventTeam[] }>(
        `/dev/events/${event.id}/entries/`,
      ),
    enabled: faction,
  });
  const [adding, setAdding] = useState("");
  const entry = useMutation({
    mutationFn: ({ slug, remove }: { slug: string; remove?: boolean }) =>
      request(`/dev/events/${event.id}/entries/${remove ? `${slug}/` : ""}`, {
        method: remove ? "DELETE" : "POST",
        body: remove ? undefined : JSON.stringify({ team: slug }),
      }),
    onSuccess: () => {
      setAdding("");
      void client.invalidateQueries({ queryKey: entriesKey });
      void client.invalidateQueries({ queryKey: ["event-entries", event.id] });
    },
  });
  const teams = entries.data?.entries ?? [];
  const [draft, setDraft] = useState({
    ...blank,
    locks_at: localDate(event.starts_at),
  });
  const refresh = () => {
    void client.invalidateQueries({ queryKey: key });
    void client.invalidateQueries({ queryKey: ["pickems", event.id] });
    void client.invalidateQueries({ queryKey: ["developer"] });
  };
  const create = useMutation({
    mutationFn: () =>
      request(base, {
        method: "POST",
        body: JSON.stringify({
          label: draft.label,
          ...(faction
            ? { team_a: draft.team_a, team_b: draft.team_b }
            : { option_a: draft.option_a, option_b: draft.option_b }),
          points: Number(draft.points) || 1,
          order: board.data?.matchups.length ?? 0,
          locks_at: draft.locks_at
            ? new Date(draft.locks_at).toISOString()
            : undefined,
        }),
      }),
    onSuccess: () => {
      setDraft((d) => ({ ...blank, locks_at: d.locks_at, points: d.points }));
      refresh();
    },
  });
  const change = useMutation({
    mutationFn: ({
      matchup,
      body,
      method = "PATCH",
    }: {
      matchup: PickemMatchup;
      body?: Record<string, unknown>;
      method?: string;
    }) =>
      request(`${base}${matchup.id}/`, {
        method,
        body: body ? JSON.stringify(body) : undefined,
      }),
    onSuccess: refresh,
  });
  const set = (k: keyof typeof draft, value: string) => {
    setDraft((d) => ({ ...d, [k]: value }));
    create.reset();
  };
  const busy = create.isPending || change.isPending || entry.isPending;
  const error =
    board.error || create.error || change.error || entries.error || entry.error;
  return (
    <Modal title="PICK'EMS" onClose={onClose} dismissible={!busy}>
      <div className="pickem-manager">
        <p className="registration-help">
          {event.title} · {eventDate(event.starts_at)}
          {!event.is_published && " · Draft: players see pick'ems once the event is published."}
        </p>
        {faction && (
          <section className="pickem-entries" aria-labelledby="pickem-entries-title">
            <h3 className="pickem-heading" id="pickem-entries-title">
              <UsersRound size={16} /> Registered teams ({teams.length})
            </h3>
            <p className="registration-help">
              Faction leaders register from the event page until it starts. You
              can also add teams from the Teams list here.
            </p>
            {teams.length > 0 && (
              <ul className="pickem-entry-list">
                {teams.map((team) => (
                  <li key={team.slug}>
                    <a href={team.url}>
                      <b>[{team.tag}]</b> {team.name}
                    </a>
                    <button
                      type="button"
                      className="button secondary"
                      aria-label={`Remove ${team.name} from this event`}
                      disabled={busy}
                      onClick={() => entry.mutate({ slug: team.slug, remove: true })}
                    >
                      <Trash2 size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <form
              className="pickem-entry-add"
              onSubmit={(e) => {
                e.preventDefault();
                if (adding) entry.mutate({ slug: adding });
              }}
            >
              <select
                aria-label="Team to add"
                value={adding}
                disabled={busy || !entries.data?.available.length}
                onChange={(e) => setAdding(e.target.value)}
              >
                <option value="">
                  {entries.data?.available.length
                    ? "Add a registered team…"
                    : "All registered teams are entered"}
                </option>
                {entries.data?.available.map((team) => (
                  <option key={team.slug} value={team.slug}>
                    [{team.tag}] {team.name}
                  </option>
                ))}
              </select>
              <button className="button secondary" disabled={busy || !adding}>
                <Plus size={15} /> Add team
              </button>
            </form>
          </section>
        )}
        <h3 className="pickem-heading">New matchup</h3>
        <form
          className="registration-form pickem-create"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <fieldset disabled={busy}>
            <label className="registration-field">
              Label (optional)
              <input
                maxLength={80}
                placeholder="e.g. Grand final"
                value={draft.label}
                onChange={(e) => set("label", e.target.value)}
              />
            </label>
            {faction ? (
              <div className="registration-two-columns">
                {(["team_a", "team_b"] as const).map((k, index) => (
                  <label className="registration-field" key={k}>
                    Team {index ? "B" : "A"}
                    <select
                      required
                      aria-label={`Team ${index ? "B" : "A"}`}
                      value={draft[k]}
                      onChange={(e) => set(k, e.target.value)}
                    >
                      <option value="">Choose a team…</option>
                      {teams.map((team) => (
                        <option
                          key={team.slug}
                          value={team.slug}
                          disabled={draft[index ? "team_a" : "team_b"] === team.slug}
                        >
                          [{team.tag}] {team.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            ) : (
              <div className="registration-two-columns">
                <label className="registration-field">
                  Option A
                  <input
                    required
                    maxLength={80}
                    value={draft.option_a}
                    onChange={(e) => set("option_a", e.target.value)}
                  />
                </label>
                <label className="registration-field">
                  Option B
                  <input
                    required
                    maxLength={80}
                    value={draft.option_b}
                    onChange={(e) => set("option_b", e.target.value)}
                  />
                </label>
              </div>
            )}
            <div className="registration-two-columns">
              <label className="registration-field">
                Picks lock at
                <input
                  type="datetime-local"
                  value={draft.locks_at}
                  onChange={(e) => set("locks_at", e.target.value)}
                />
              </label>
              <label className="registration-field">
                Points for a correct pick
                <input
                  type="number"
                  min={1}
                  max={100}
                  required
                  value={draft.points}
                  onChange={(e) => set("points", e.target.value)}
                />
              </label>
            </div>
          </fieldset>
          <div className="event-editor-actions">
            <button
              className="button primary"
              disabled={busy || (faction && teams.length < 2)}
            >
              <Plus size={15} /> {create.isPending ? "Adding…" : "Add matchup"}
            </button>
          </div>
          {faction && !entries.isPending && teams.length < 2 && (
            <p className="registration-help">
              At least two registered teams are needed to add a matchup.
            </p>
          )}
        </form>
        {error && (
          <p className="registration-error" role="alert">
            {error.message}
          </p>
        )}
        <h3 className="pickem-heading">Matchups</h3>
        {board.isPending ? (
          <p role="status">Loading pick'ems…</p>
        ) : board.data?.matchups.length ? (
          <div className="pickem-dev-list">
            {board.data.matchups.map((m) => (
              <article key={m.id}>
                <div>
                  <div className="dev-event-labels">
                    {m.label && <span className="event-status">{m.label}</span>}
                    <span>{m.points} pt{m.points === 1 ? "" : "s"}</span>
                    <span>
                      {m.locked ? "Locked" : "Locks"} {eventDate(m.locks_at)}
                    </span>
                  </div>
                  <p className="pickem-dev-options">
                    <b>{m.option_a}</b> <small>{m.picks?.A ?? 0} picks</small>
                    <span>vs</span>
                    <b>{m.option_b}</b> <small>{m.picks?.B ?? 0} picks</small>
                  </p>
                </div>
                <div className="dev-event-actions">
                  <label className="pickem-winner">
                    Winner
                    <select
                      aria-label={`Winner of ${m.option_a} vs ${m.option_b}`}
                      value={m.winner ?? ""}
                      disabled={busy}
                      onChange={(e) =>
                        change.mutate({
                          matchup: m,
                          body: { winner: e.target.value as PickSide | "" },
                        })
                      }
                    >
                      <option value="">Undecided</option>
                      <option value="A">{m.option_a}</option>
                      <option value="B">{m.option_b}</option>
                    </select>
                  </label>
                  {!m.locked && (
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() =>
                        change.mutate({
                          matchup: m,
                          body: { locks_at: new Date().toISOString() },
                        })
                      }
                    >
                      Lock now
                    </button>
                  )}
                  <button
                    className="button secondary"
                    aria-label={`Delete ${m.option_a} vs ${m.option_b}`}
                    disabled={busy}
                    onClick={() => {
                      const picks = (m.picks?.A ?? 0) + (m.picks?.B ?? 0);
                      if (
                        window.confirm(
                          `Delete this matchup${picks ? ` and its ${picks} pick${picks === 1 ? "" : "s"}` : ""}?`,
                        )
                      )
                        change.mutate({ matchup: m, method: "DELETE" });
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="event-empty">
            <Trophy size={26} />
            <p>No matchups yet. Add one above.</p>
          </div>
        )}
        {Boolean(board.data?.leaderboard.length) && (
          <>
            <h3 className="pickem-heading">Standings</h3>
            <PickemStandings rows={board.data!.leaderboard} />
          </>
        )}
      </div>
    </Modal>
  );
}

export function PickemStandings({
  rows,
  me,
}: {
  rows: PickemStanding[];
  me?: string;
}) {
  return (
    <div className="dev-table-wrap">
      <table className="dev-table pickem-table">
        <thead>
          <tr>
            <th>#</th>
            <th>PLAYER</th>
            <th>POINTS</th>
            <th>CORRECT</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.username} className={row.username === me ? "pickem-me" : ""}>
              <td>{row.rank}</td>
              <td>
                <a href={row.url}>{row.display_name}</a>
              </td>
              <td>{row.points}</td>
              <td>
                {row.correct}/{row.decided}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
