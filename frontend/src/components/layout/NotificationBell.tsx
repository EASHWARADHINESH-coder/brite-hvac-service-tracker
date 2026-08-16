import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { getNotifications, markAllNotificationsRead, markNotificationRead } from "../../api/services";
import type { AppNotification, NotificationList } from "../../types";

const KIND_ICON: Record<string, string> = {
  task_assigned: "📋",
  task_due: "⏰",
  task_overdue: "⚠️",
  task_completed: "✅",
  ticket_assigned: "🎫",
};

const timeAgo = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/** Top-bar notification bell: unread badge + dropdown list, polled every 60s. */
export default function NotificationBell() {
  const [data, setData] = useState<NotificationList>({ unread: 0, items: [] });
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const nav = useNavigate();

  const load = () => getNotifications().then(setData).catch(() => undefined);

  useEffect(() => {
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  // Close on outside click.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const openItem = async (n: AppNotification) => {
    if (!n.is_read) {
      await markNotificationRead(n.id).catch(() => undefined);
      load();
    }
    setOpen(false);
    if (n.link) nav(n.link);
  };

  const readAll = async () => {
    await markAllNotificationsRead().catch(() => undefined);
    load();
  };

  return (
    <div className="relative" ref={boxRef}>
      <button
        onClick={() => { setOpen((o) => !o); if (!open) load(); }}
        aria-label="Notifications"
        className="relative rounded-full p-2 text-slate-500 hover:bg-slate-100"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {data.unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
            {data.unread > 9 ? "9+" : data.unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2">
            <span className="text-sm font-semibold text-slate-700">Notifications</span>
            {data.unread > 0 && (
              <button onClick={readAll} className="text-xs font-medium text-sky-600 hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {data.items.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">You're all caught up 🎉</p>
            ) : (
              data.items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => openItem(n)}
                  className={`flex w-full items-start gap-2 border-b border-slate-50 px-4 py-2.5 text-left hover:bg-slate-50 ${
                    n.is_read ? "" : "bg-sky-50/50"
                  }`}
                >
                  <span className="mt-0.5 shrink-0 text-base">{KIND_ICON[n.kind] ?? "🔔"}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${n.is_read ? "text-slate-600" : "font-medium text-slate-800"}`}>
                      {n.title}
                    </span>
                    {n.body && <span className="block truncate text-xs text-slate-400">{n.body}</span>}
                    <span className="text-[10px] text-slate-400">{timeAgo(n.created_at)}</span>
                  </span>
                  {!n.is_read && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-sky-500" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
