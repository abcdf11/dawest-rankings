import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, Check } from "lucide-react";
import { useSession } from "../hooks/useSession";
import { request } from "../lib/api";
import type { CompetitionEvent } from "../types/events";

export function EventInterest({
  event,
  explain = false,
}: {
  event: CompetitionEvent;
  explain?: boolean;
}) {
  const session = useSession();
  const client = useQueryClient();
  const following = Boolean(event.is_interested);
  const closed = ["COMPLETED", "CANCELLED"].includes(event.status);
  const user = session.data?.user;
  const change = useMutation({
    mutationFn: () =>
      request(`/events/${event.id}/interested/`, {
        method: following ? "DELETE" : "POST",
      }),
    onSuccess: () => {
      for (const key of ["events", "event", "event-notifications"])
        void client.invalidateQueries({ queryKey: [key] });
    },
  });
  return (
    <div className="event-interest">
      <div className="event-interest-controls">
        {!closed || following ? (
          !session.isPending && !user ? (
            <a
              className="button secondary"
              href={`/login?next=${encodeURIComponent(event.url)}`}
            >
              <Bell size={16} /> Interested
            </a>
          ) : (
            <button
              className={`button ${following ? "primary" : "secondary"}`}
              aria-pressed={following}
              disabled={change.isPending || session.isPending || !user?.player}
              title={
                user && !user.player
                  ? "Sign in with a player account to follow events."
                  : following
                    ? "Stop receiving event notifications"
                    : "Get event notifications"
              }
              onClick={() => change.mutate()}
            >
              {following ? <Check size={16} /> : <Bell size={16} />}
              {change.isPending ? "Saving…" : "Interested"}
            </button>
          )
        ) : null}
        <span className="event-interest-count" aria-live="polite">
          <BellRing size={15} aria-hidden="true" />{" "}
          {event.interested_count ?? 0} interested
        </span>
      </div>
      {explain && !closed && (
        <p className="event-interest-help">
          {following
            ? "You’ll get a notification here when this event starts or its details change."
            : "Mark Interested to get notifications here when the event starts or changes."}
        </p>
      )}
      {change.error && (
        <p className="registration-error" role="alert">
          {change.error.message}
        </p>
      )}
    </div>
  );
}
