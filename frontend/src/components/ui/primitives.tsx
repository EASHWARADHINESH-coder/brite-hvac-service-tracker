import { useEffect, useMemo, useRef, useState } from "react";
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

/** Title is optional: omit it when the page is embedded under a shared header (e.g. tabs). */
export function PageHeader({ title, action }: { title?: string; action?: ReactNode }) {
  return (
    <div className={`flex items-center justify-between ${title ? "mb-6" : "mb-4 justify-end"}`}>
      {title && <h1 className="text-2xl font-bold text-slate-800">{title}</h1>}
      {action}
    </div>
  );
}

export function Button({
  children,
  variant = "primary",
  ...props
}: { children: ReactNode; variant?: "primary" | "ghost" } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    "inline-flex items-center rounded-md px-3 py-2 text-sm font-medium transition disabled:opacity-50";
  const styles =
    variant === "primary"
      ? "bg-slate-800 text-white hover:bg-slate-700"
      : "border border-slate-300 text-slate-700 hover:bg-slate-50";
  return (
    <button className={`${base} ${styles}`} {...props}>
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none";

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${inputCls} ${className}`} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={inputCls} {...props} />;
}

export type ComboOption = {
  value: string;
  label: string;
  /** Secondary text shown greyed next to the label (e.g. a customer's city). Also searchable. */
  hint?: string;
};

/**
 * Searchable single-select dropdown: type to filter, arrows/enter to pick.
 * Filtering happens in the browser, so pass the full option list.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  emptyText = "No matches",
  allowClear = true,
  disabled = false,
  onCreate,
  createLabel = (q) => `＋ Add "${q}"`,
}: {
  options: ComboOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  allowClear?: boolean;
  disabled?: boolean;
  /** When set, an "add new" row appears for a query with no exact match. */
  onCreate?: (query: string) => void;
  createLabel?: (query: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    // Match on label + hint so "chennai" finds a customer by city.
    return options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(q));
  }, [options, query]);

  // Close when clicking outside; drop the half-typed query.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const typed = query.trim();
  // Offer "add new" only for a non-empty query that doesn't already name an option.
  const canCreate =
    !!onCreate && typed.length > 0 &&
    !options.some((o) => o.label.toLowerCase() === typed.toLowerCase());

  const pick = (opt: ComboOption) => {
    onChange(opt.value);
    setOpen(false);
    setQuery("");
  };

  const create = () => {
    onCreate?.(typed);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // The "add new" row, when shown, sits at index === shown.length.
    const rows = shown.length + (canCreate ? 1 : 0);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => (rows ? (i + step + rows) % rows : 0));
    } else if (e.key === "Enter") {
      if (!open) return;
      if (shown[active]) { e.preventDefault(); pick(shown[active]); }
      else if (canCreate && active === shown.length) { e.preventDefault(); create(); }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <input
          className={`${inputCls} ${disabled ? "cursor-not-allowed bg-slate-50" : ""} pr-14`}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          disabled={disabled}
          placeholder={selected ? selected.label : placeholder}
          value={open ? query : selected?.label ?? ""}
          onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <div className="absolute inset-y-0 right-2 flex items-center gap-1">
          {allowClear && selected && !disabled && (
            <button
              type="button"
              aria-label="Clear"
              className="rounded px-1 text-slate-400 hover:text-slate-600"
              onClick={() => { onChange(""); setQuery(""); }}
            >
              ✕
            </button>
          )}
          <span className="pointer-events-none text-xs text-slate-400">▾</span>
        </div>
      </div>

      {open && !disabled && (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {shown.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              className={`flex cursor-pointer items-baseline gap-2 px-3 py-2 ${
                i === active ? "bg-slate-100" : ""
              } ${o.value === value ? "font-semibold text-slate-800" : "text-slate-700"}`}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }}
            >
              <span className="shrink-0">{o.label}</span>
              {/* Hint stays fully searchable even when visually truncated. */}
              {o.hint && (
                <span className="truncate text-xs text-slate-400" title={o.hint}>
                  {o.hint}
                </span>
              )}
            </li>
          ))}
          {canCreate && (
            <li
              role="option"
              aria-selected={false}
              className={`cursor-pointer border-t border-slate-100 px-3 py-2 font-medium text-sky-600 ${
                active === shown.length ? "bg-sky-50" : ""
              }`}
              onMouseEnter={() => setActive(shown.length)}
              onMouseDown={(e) => { e.preventDefault(); create(); }}
            >
              {createLabel(typed)}
            </li>
          )}
          {shown.length === 0 && !canCreate && (
            <li className="px-3 py-2 text-slate-400">{emptyText}</li>
          )}
        </ul>
      )}
    </div>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      onMouseDown={onClose}
    >
      <div
        className="my-8 w-full max-w-lg rounded-lg border border-slate-200 bg-white shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h2 className="font-semibold text-slate-800">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * A sortable column declares a key; a plain string stays unsortable (e.g. an actions column).
 * A ReactNode label lets a header hold a control, such as a select-all checkbox.
 */
export type Column = string | { label: ReactNode; key?: string };

export type SortState = {
  by: string | null;
  dir: "asc" | "desc";
  onChange: (key: string) => void;
};

export function Table({
  head,
  children,
  sort,
}: {
  head: Column[];
  children: ReactNode;
  sort?: SortState;
}) {
  return (
    // Horizontal scrolling is applied only below `lg`. Any overflow value here makes this a
    // scroll container, which would anchor the sticky header to this box instead of the page
    // (overflow-y:clip is no help — the spec downgrades it to hidden when the other axis
    // scrolls). So on desktop we leave overflow alone and the header sticks to the viewport;
    // on small screens horizontal scroll wins and the header simply scrolls normally.
    <div className="max-lg:overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {/* Keyed by index: some tables use blank headers (checkbox / actions columns). */}
            {head.map((h, i) => {
              const col = typeof h === "string" ? { label: h, key: null } : h;
              const sortable = sort && col.key;
              const active = sortable && sort.by === col.key;
              return (
                <th
                  key={i}
                  className="sticky top-0 z-10 bg-slate-50 px-4 py-3 text-left font-semibold text-slate-600"
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => sort.onChange(col.key as string)}
                      className={`inline-flex items-center gap-1 rounded hover:text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
                        active ? "text-slate-900" : ""
                      }`}
                      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    >
                      {col.label}
                      <span className={active ? "text-slate-900" : "text-slate-300"}>
                        {active ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    col.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

/**
 * Client-side table sorting. Pass one accessor per sortable column key; the hook returns the
 * sorted rows plus the `sort` object to hand to <Table>. Clicking the active column flips
 * direction. Blank values always sort last, regardless of direction.
 */
export function useTableSort<T>(
  rows: T[],
  accessors: Record<string, (row: T) => string | number | null | undefined>,
  initial?: { by: string; dir?: "asc" | "desc" },
) {
  const [by, setBy] = useState<string | null>(initial?.by ?? null);
  const [dir, setDir] = useState<"asc" | "desc">(initial?.dir ?? "asc");

  const onChange = (key: string) => {
    if (key === by) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setBy(key); setDir("asc"); }
  };

  const sorted = useMemo(() => {
    const get = by ? accessors[by] : undefined;
    if (!get) return rows;
    const flip = dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      const aEmpty = av === null || av === undefined || av === "";
      const bEmpty = bv === null || bv === undefined || bv === "";
      if (aEmpty && bEmpty) return 0;
      if (aEmpty) return 1;   // blanks last in both directions
      if (bEmpty) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * flip;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * flip;
    });
  }, [rows, by, dir, accessors]);

  return { rows: sorted, sort: { by, dir, onChange } as SortState };
}

/**
 * Client-side pagination. Give it the (already filtered/sorted) rows and a page size; it returns
 * the current page's rows plus the props to hand to <Pagination>. Snaps back to page 1 whenever
 * the row count shrinks below the current page (e.g. a filter narrows the list).
 */
export function usePagination<T>(rows: T[], pageSize = 25) {
  const [page, setPage] = useState(1);
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  useEffect(() => { if (page > totalPages) setPage(1); }, [page, totalPages]);
  const current = Math.min(page, totalPages);
  const start = (current - 1) * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  return { pageRows, page: current, setPage, totalPages, total, start, pageSize };
}

type PaginationProps = {
  page: number;
  setPage: (p: number) => void;
  totalPages: number;
  total: number;
  start: number;
  pageSize: number;
};

/** Prev / next pager with an "showing X–Y of N" count. Hidden when everything fits one page. */
export function Pagination({ page, setPage, totalPages, total, start, pageSize }: PaginationProps) {
  if (total === 0) return null;
  const from = start + 1;
  const to = Math.min(start + pageSize, total);
  const btn =
    "rounded-md border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 " +
    "hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
      <span>
        Showing <span className="font-medium text-slate-700">{from}–{to}</span> of{" "}
        <span className="font-medium text-slate-700">{total}</span>
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <button type="button" className={btn} disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ← Prev
          </button>
          <span>Page {page} of {totalPages}</span>
          <button type="button" className={btn} disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}

/** Grey placeholder in the shape of the content it replaces. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

/** Skeleton shaped like a Table, so lists don't jump when real rows arrive. */
export function TableSkeleton({ cols, rows = 5 }: { cols: number; rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex gap-4 border-b border-slate-200 bg-slate-50 px-4 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 border-b border-slate-100 px-4 py-3 last:border-0">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className="h-3 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

/** Skeleton shaped like a row of KPI cards. */
export function CardSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i}>
          <Skeleton className="h-8 w-16" />
          <Skeleton className="mt-2 h-3 w-24" />
        </Card>
      ))}
    </div>
  );
}
