import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Lock, Trophy } from "lucide-react";
import { request } from "../lib/api";
import { useSession } from "../hooks/useSession";
import type { PickemBoard, PickSide } from "../types/events";
import { eventDate } from "./EventsPage";
import { PickemStandings } from "./PickemManager";

export function PickemPanel({ eventId }: { eventId: string }) {
  const client = useQueryClient();
  const session = useSession();
  const key = ["pickems", eventId];
  const board = useQuery({
    queryKey: [...key, session.data?.user?.id ?? null],
    queryFn: () =>
      request<PickemBoard>(`/events/${encodeURIComponent(eventId)}/pickems/`),
    staleTime: 15_000,
    refetchInterval: 60_000,
  });
  const pick = useMutation({
    mutationFn: ({ id, choice }: { id: number; choice: PickSide }) =>
      request(`/events/${encodeURIComponent(eventId)}/pickems/${id}/pick/`, {
        method: "POST",
        body: JSON.stringify({ choice }),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey: key }),
  });
  const data = board.data;
  if (board.isPending || board.error || !data?.matchups.length) return null;
  const me = session.data?.user?.player?.username;
  return (
    <section className="event-results pickem-panel" aria-labelledby="pickem-title">
      <div className="pickem-panel-heading">
        <h2 id="pickem-title">Pick'ems</h2>
        <span>
          {data.participants} participant{data.participants === 1 ? "" : "s"}
          {data.me && ` · You: #${data.me.rank}, ${data.me.points} pts`}
        </span>
      </div>
      {!data.can_pick && (
        <p className="registration-help">
          {session.data?.user ? (
            "Only registered players can make picks."
          ) : (
            <>
              <a href={`/login?next=${encodeURIComponent(location.pathname)}`}>
                Sign in
              </a>{" "}
              to make your picks.
            </>
          )}
        </p>
      )}
      {pick.error && (
        <p className="registration-error" role="alert">
          {pick.error.message}
        </p>
      )}
      <div className="pickem-list">
        {data.matchups.map((m) => {
          const total = m.picks ? m.picks.A + m.picks.B : 0;
          const option = (side: PickSide, name: string) => {
            const chosen = m.my_pick === side;
            const share = m.picks && total ? Math.round((m.picks[side] / total) * 100) : null;
            const result = m.winner ? (m.winner === side ? "won" : "lost") : "";
            return (
              <button
                type="button"
                className={`pickem-option ${chosen ? "chosen" : ""} ${result}`}
                aria-pressed={chosen}
                disabled={m.locked || !data.can_pick || pick.isPending}
                onClick={() => pick.mutate({ id: m.id, choice: side })}
              >
                <span>{name}</span>
                {chosen && <Check size={15} aria-label="Your pick" />}
                {share !== null && <small>{share}%</small>}
              </button>
            );
          };
          return (
            <article key={m.id} className="pickem-card">
              <div className="pickem-card-top">
                <span>{m.label || "Matchup"}</span>
                <span>
                  {m.points} pt{m.points === 1 ? "" : "s"} ·{" "}
                  {m.winner ? (
                    m.my_pick ? (
                      m.my_pick === m.winner ? "Correct" : "Missed"
                    ) : (
                      "Decided"
                    )
                  ) : m.locked ? (
                    <>
                      <Lock size={12} /> Locked
                    </>
                  ) : (
                    <>Locks {eventDate(m.locks_at)}</>
                  )}
                </span>
              </div>
              <div className="pickem-options">
                {option("A", m.team_a ? `[${m.team_a.tag}] ${m.option_a}` : m.option_a)}
                <span className="pickem-vs">vs</span>
                {option("B", m.team_b ? `[${m.team_b.tag}] ${m.option_b}` : m.option_b)}
              </div>
            </article>
          );
        })}
      </div>
      {data.leaderboard.length > 0 && (
        <>
          <h3 className="pickem-heading">
            <Trophy size={16} /> Standings
          </h3>
          <PickemStandings rows={data.leaderboard} me={me} />
        </>
      )}
    </section>
  );
}
