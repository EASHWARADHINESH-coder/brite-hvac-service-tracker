import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { aiSearch, listCustomers, listTeam, listTickets } from "../../api/services";
import { useAuth } from "../../context/AuthContext";
import type { AIRetrieved, Customer, TeamMember, Ticket } from "../../types";

type Hit = {
  kind: "Ticket" | "Customer" | "Team" | "Related";
  title: string;
  subtitle: string;
  to: string;
  /** Everything matched against, so a ticket is findable by its customer or city too. */
  haystack: string;
};

const MAX_PER_KIND = 5;

/**
 * Ctrl/Cmd + K search across tickets, customers and team members.
 *
 * Data is fetched once when the palette first opens and filtered in the browser — the lists
 * are small enough that this is instant, and it avoids a search endpoint.
 */
export default function CommandPalette() {
  const nav = useNavigate();
  const { isAdmin, isPrivileged } = useAuth();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  // Global shortcut.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Load once, the first time it's opened.
  useEffect(() => {
    if (!open || loaded) return;
    setLoaded(true);
    listTickets().then(setTickets).catch(() => setTickets([]));
    if (isPrivileged) listCustomers().then(setCustomers).catch(() => setCustomers([]));
    if (isAdmin) listTeam().then(setTeam).catch(() => setTeam([]));
  }, [open, loaded, isAdmin, isPrivileged]);

  useEffect(() => {
    if (open) { setQ(""); setActive(0); setTimeout(() => inputRef.current?.focus(), 0); }
  }, [open]);

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const hits = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const match = (h: Hit) => h.haystack.toLowerCase().includes(needle);

    const t: Hit[] = tickets.map((x) => ({
      kind: "Ticket",
      title: x.ticket_no,
      subtitle: [x.customer_name, x.customer_city, x.status].filter(Boolean).join(" · "),
      to: `/tickets/${x.id}`,
      haystack: [x.ticket_no, x.customer_name, x.customer_city, x.work_type, x.skill]
        .filter(Boolean).join(" "),
    }));
    const c: Hit[] = customers.map((x) => ({
      kind: "Customer",
      title: x.name,
      subtitle: x.city ?? "",
      to: `/customers-pms?tab=Customers`,
      haystack: [x.name, x.city, x.contact_person].filter(Boolean).join(" "),
    }));
    const m: Hit[] = team.map((x) => ({
      kind: "Team",
      title: x.name,
      subtitle: x.team_type,
      to: `/team/${x.id}`,
      haystack: [x.name, x.team_type, x.skills].filter(Boolean).join(" "),
    }));

    return [
      ...t.filter(match).slice(0, MAX_PER_KIND),
      ...c.filter(match).slice(0, MAX_PER_KIND),
      ...m.filter(match).slice(0, MAX_PER_KIND),
    ];
  }, [q, tickets, customers, team]);

  // Semantic hits come from the vector store — they catch wording the keyword filter misses
  // ("no cooling" finding a gas-leak ticket). Debounced so typing doesn't spam the embedder.
  const [semantic, setSemantic] = useState<AIRetrieved[]>([]);
  useEffect(() => {
    const needle = q.trim();
    if (!isPrivileged || needle.length < 3) { setSemantic([]); return; }
    const t = setTimeout(() => {
      aiSearch(needle, 4).then(setSemantic).catch(() => setSemantic([]));
    }, 350);
    return () => clearTimeout(t);
  }, [q, isPrivileged]);

  // Anything already matched by keyword shouldn't appear twice.
  const exactTargets = new Set(hits.map((h) => h.to));
  // Route each semantic hit to the right place for its kind. Claims have no per-item page,
  // so they open the Claims tab; PMS opens the PMS tab.
  const routeFor = (r: AIRetrieved): string => {
    switch (r.kind) {
      case "ticket": return `/tickets/${r.ref_id}`;
      case "pms": return "/customers-pms?tab=PMS";
      case "claim": return "/materials?tab=Claims";
      case "material": return "/materials?tab=Stock";
      case "inward": return "/materials?tab=Inward";
      case "issue": return "/materials?tab=Issues";
      default: return "/customers-pms?tab=Customers";
    }
  };
  const semanticHits: Hit[] = semantic
    .map((r) => ({
      kind: "Related" as const,
      title: r.label,
      subtitle: r.text
        .replace(/^(Ticket|PMS work order|Material claim|Material inward|Material issue|Material) \S+ \| /, "")
        .slice(0, 70),
      to: routeFor(r),
      haystack: r.text,
    }))
    // De-dupe by title too, since several claim/pms hits can share the Claims/PMS tab URL.
    .filter((h, i, arr) => !exactTargets.has(h.to) &&
      arr.findIndex((x) => x.to === h.to && x.title === h.title) === i);

  const allHits = [...hits, ...semanticHits];

  const go = (h: Hit) => { setOpen(false); nav(h.to); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (allHits.length ? (i + 1) % allHits.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (allHits.length ? (i - 1 + allHits.length) % allHits.length : 0));
    } else if (e.key === "Enter" && allHits[active]) {
      e.preventDefault();
      go(allHits[active]);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-start justify-center bg-slate-900/40 p-4 pt-24"
      onMouseDown={() => setOpen(false)}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
          <span className="text-slate-400">⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActive(0); }}
            onKeyDown={onKeyDown}
            placeholder="Search tickets, customers, team…"
            className="flex-1 text-sm outline-none placeholder:text-slate-400"
          />
          <kbd className="rounded border border-slate-300 border-b-2 px-1.5 py-0.5 text-[10px] text-slate-500">
            ESC
          </kbd>
        </div>

        <ul ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {allHits.map((h, i) => (
            <li
              key={`${h.kind}-${h.to}-${h.title}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); go(h); }}
              className={`flex cursor-pointer items-center gap-3 px-4 py-2 text-sm ${
                i === active ? "bg-sky-50" : ""
              }`}
            >
              <span className="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {h.kind}
              </span>
              <span className={h.kind === "Ticket" ? "font-mono text-sky-700" : "font-medium text-slate-800"}>
                {h.title}
              </span>
              <span className="truncate text-xs text-slate-500">{h.subtitle}</span>
            </li>
          ))}
          {q.trim() && allHits.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-slate-400">No matches</li>
          )}
          {!q.trim() && (
            <li className="px-4 py-6 text-center text-xs text-slate-400">
              Type a ticket number, customer, city or name
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
