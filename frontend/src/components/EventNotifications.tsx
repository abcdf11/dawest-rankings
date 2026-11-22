import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, CalendarDays } from "lucide-react";
import { request } from "../lib/api";
import type { EventInbox } from "../types/events";
import { Modal } from "./Modal";
import { ProfileMediaImage } from "./ProfileMediaImage";

export function EventNotifications({ userId }: { userId: number }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const client = useQueryClient();
  const queryKey = ["event-notifications", userId];
  const inbox = useQuery({
    queryKey,
    queryFn: () => request<EventInbox>("/event-notifications/"),
    refetchInterval: 30_000,
    staleTime: 15_000,
    retry: 1,
  });
  const read = useMutation({
    mutationFn: (body: { ids?: number[]; all?: boolean }) =>
      request("/event-notifications/read/", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => void client.invalidateQueries({ queryKey }),
  });
  const unread = inbox.data?.unread_count ?? 0;
  return (
    <>
      <button
        className="icon-button event-notification-button"
        aria-label={`Event notifications${unread ? ` (${unread} unread)` : ""}`}
        onClick={() => setOpen(true)}
      >
        <Bell size={17} />
        {unread > 0 && (
          <span className="event-notification-badge">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <Modal title="EVENT NOTIFICATIONS" onClose={close}>
            <div className="event-inbox">
              <div className="event-inbox-heading">
                <h2>Event notifications</h2>
                {unread > 0 && (
                  <button
                    className="button secondary"
                    disabled={read.isPending}
                    onClick={() => read.mutate({ all: true })}
                  >
                    Mark all read
                  </button>
                )}
              </div>
              {(inbox.error || read.error) && (
                <p role="alert" className="registration-error">
                  {inbox.error?.message || read.error?.message}{" "}
                  <button onClick={() => void inbox.refetch()}>
                    Try again
                  </button>
                </p>
              )}
              {inbox.isPending ? (
                <p role="status">Loading notifications…</p>
              ) : inbox.data?.notifications.length ? (
                <ul className="event-notice-list">
                  {inbox.data.notifications.map((notice) => (
                    <li
                      key={notice.id}
                      className={notice.read_at ? "" : "unread"}
                    >
                      <a
                        href={notice.event.url}
                        onClick={(e) => {
                          if (
                            notice.read_at ||
                            e.ctrlKey ||
                            e.metaKey ||
                            e.shiftKey ||
                            e.altKey
                          )
                            return;
                          e.preventDefault();
                          read.mutate(
                            { ids: [notice.id] },
                            {
                              onSuccess: () =>
                                window.location.assign(notice.event.url),
                            },
                          );
                        }}
                      >
                        {notice.event.logo_url ? (
                          <ProfileMediaImage
                            src={notice.event.logo_url}
                            alt=""
                            width={42}
                            height={42}
                          />
                        ) : (
                          <CalendarDays size={24} aria-hidden="true" />
                        )}
                        <span>
                          <strong>
                            {notice.event.title}
                            {!notice.read_at && (
                              <span className="event-unread-label">Unread</span>
                            )}
                          </strong>
                          <span>{notice.message}</span>
                          <time dateTime={notice.created_at}>
                            {new Date(notice.created_at).toLocaleString()}
                          </time>
                        </span>
                      </a>
                    </li>
                  ))}
                </ul>
              ) : !inbox.error ? (
                <p className="event-inbox-empty">
                  No notifications yet. Mark an event as Interested to follow
                  its updates.
                </p>
              ) : null}
            </div>
          </Modal>,
          document.body,
        )}
    </>
  );
}
