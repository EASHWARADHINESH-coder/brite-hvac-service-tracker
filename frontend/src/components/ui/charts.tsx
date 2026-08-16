import { useId, useState } from "react";
import { Link } from "react-router-dom";

/**
 * Small dependency-free chart set.
 *
 * Colour follows the job, never the rank:
 *   - magnitude (counts by category) -> one hue, varying only in weight
 *   - status (Open / In Progress / ...) -> the reserved status palette, always beside a label
 * Marks are thin with rounded data-ends, grid and axes stay recessive, and every mark has a
 * hover affordance. Values use tabular figures so digits line up down a column.
 */

// Status fills come from the same tokens as the rest of the app, so they re-theme with it.
const STATUS_FILL: Record<string, string> = {
  Open: "rgb(var(--amber-600))",
  "In Progress": "rgb(var(--blue-600))",
  Closed: "rgb(var(--emerald-600))",
  Reopened: "rgb(var(--rose-600))",
};

// Single-hue sequential for plain magnitude charts (work type, contract mix).
const MAGNITUDE = "var(--chart-magnitude)";
const GRID = "var(--chart-grid)";

export type BarDatum = { label: string; value: number };

/**
 * Horizontal bars — the right form when categories have long names and the question is
 * "how many of each". Bars are sorted by the caller so order carries meaning.
 */
export function BarList({
  data,
  useStatusColor = false,
  unit = "tickets",
}: {
  data: BarDatum[];
  useStatusColor?: boolean;
  unit?: string;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);

  if (data.length === 0) {
    return <p className="text-sm text-slate-400">No data yet</p>;
  }

  return (
    <div className="space-y-2">
      {data.map((d) => {
        const pct = (d.value / max) * 100;
        const share = total > 0 ? Math.round((d.value / total) * 100) : 0;
        const fill = useStatusColor ? STATUS_FILL[d.label] ?? MAGNITUDE : MAGNITUDE;
        const on = hover === d.label;
        return (
          <div
            key={d.label}
            className="flex items-center gap-3 text-sm"
            onMouseEnter={() => setHover(d.label)}
            onMouseLeave={() => setHover(null)}
          >
            <div className="w-32 shrink-0 truncate text-slate-500" title={d.label}>
              {d.label}
            </div>
            <div className="relative h-5 flex-1 rounded bg-slate-100">
              <div
                className="h-5 rounded transition-[width] duration-300"
                style={{
                  width: `${pct}%`,
                  minWidth: d.value > 0 ? "0.35rem" : 0,
                  background: fill,
                  opacity: on ? 1 : 0.88,
                }}
              />
              {on && d.value > 0 && (
                <div className="pointer-events-none absolute -top-7 left-2 z-10 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white shadow">
                  {d.value} {unit} · {share}%
                </div>
              )}
            </div>
            <div className="w-8 text-right font-semibold tabular-nums">{d.value}</div>
          </div>
        );
      })}
    </div>
  );
}

export type StatusBar = {
  label: string;
  value: number;
  /** A semantic CSS colour (e.g. "rgb(var(--amber-600))"). */
  color: string;
  /** Where clicking the bar navigates (a pre-filtered list). */
  to: string;
};

/**
 * Horizontal bars in a fixed, meaningful order (not sorted by size), each its own semantic
 * colour and clickable to a filtered view. Used for the Dashboard's status overview, where the
 * order tells the ticket's story (Open → overdue → in progress → … → reopened).
 */
export function StatusBars({ bars }: { bars: StatusBar[] }) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className="space-y-1.5">
      {bars.map((b) => (
        <Link
          key={b.label}
          to={b.to}
          className="group flex items-center gap-3 rounded px-1 py-1 text-sm hover:bg-slate-50"
        >
          <div className="w-32 shrink-0 truncate text-slate-600 group-hover:text-slate-900" title={b.label}>
            {b.label}
          </div>
          <div className="relative h-6 flex-1 rounded bg-slate-100">
            <div
              className="flex h-6 items-center justify-end rounded px-2 transition-[width] duration-300"
              style={{
                width: `${(b.value / max) * 100}%`,
                minWidth: b.value > 0 ? "1.75rem" : 0,
                background: b.color,
              }}
            >
              {b.value > 0 && (
                <span className="text-xs font-semibold tabular-nums text-white">{b.value}</span>
              )}
            </div>
            {b.value === 0 && (
              <span className="absolute left-2 top-1 text-xs font-semibold tabular-nums text-slate-400">0</span>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

export type Column = { label: string; value: number; color: string };

/**
 * Vertical column chart in a fixed, meaningful order. Each column its own colour, the value
 * on top, the label beneath. Optional per-column click-through.
 */
export function ColumnChart({
  columns,
  height = 160,
  onClick,
}: {
  columns: Column[];
  height?: number;
  onClick?: (c: Column) => void;
}) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...columns.map((c) => c.value));
  const plotH = height - 34; // room for the value on top + the label beneath

  return (
    <div className="flex items-end gap-2" style={{ height }}>
      {columns.map((c) => {
        const on = hover === c.label;
        return (
          <div
            key={c.label}
            className={`flex flex-1 flex-col items-center justify-end ${onClick ? "cursor-pointer" : ""}`}
            style={{ height }}
            onMouseEnter={() => setHover(c.label)}
            onMouseLeave={() => setHover(null)}
            onClick={onClick ? () => onClick(c) : undefined}
          >
            <div className="text-xs font-semibold tabular-nums text-slate-700">{c.value}</div>
            <div
              className="w-full rounded-t transition-[height,opacity] duration-300"
              style={{
                height: `${(c.value / max) * plotH}px`,
                minHeight: c.value > 0 ? 3 : 0,
                background: c.color,
                opacity: on ? 1 : 0.88,
              }}
            />
            <div className="mt-1 h-8 text-center text-[11px] leading-tight text-slate-500">
              {c.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export type TrendPoint = { label: string; value: number };

/**
 * Area + line for change over time. One series, so no legend box is needed — the card
 * title names it. The last point is emphasised because "where are we now" is the question
 * this chart is usually asked.
 */
export function TrendChart({
  points,
  height = 132,
  unit = "closed",
}: {
  points: TrendPoint[];
  height?: number;
  unit?: string;
}) {
  const gradId = useId();
  const [hover, setHover] = useState<number | null>(null);

  if (points.length < 2) {
    return <p className="text-sm text-slate-400">Not enough history yet</p>;
  }

  const W = 560;
  const H = height;
  const padX = 8;
  const padTop = 14;
  const padBottom = 22;
  const max = Math.max(1, ...points.map((p) => p.value));
  const plotH = H - padTop - padBottom;

  const x = (i: number) => padX + (i * (W - padX * 2)) / (points.length - 1);
  const y = (v: number) => padTop + plotH - (v / max) * plotH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
  const area = `${line} L${x(points.length - 1)},${padTop + plotH} L${x(0)},${padTop + plotH} Z`;
  const last = points.length - 1;
  const active = hover ?? last;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${unit} per week trend`}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={MAGNITUDE} stopOpacity="0.22" />
            <stop offset="100%" stopColor={MAGNITUDE} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Recessive gridlines — present for reading values, never competing with the data. */}
        {[0, 0.5, 1].map((f) => (
          <line
            key={f}
            x1={padX}
            x2={W - padX}
            y1={padTop + plotH * f}
            y2={padTop + plotH * f}
            stroke={GRID}
            strokeWidth="1"
          />
        ))}

        <path d={area} fill={`url(#${gradId})`} />
        <path d={line} fill="none" stroke={MAGNITUDE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {/* Crosshair for the point under the cursor. */}
        {hover !== null && (
          <line x1={x(hover)} x2={x(hover)} y1={padTop} y2={padTop + plotH} stroke="rgb(var(--slate-400))" strokeWidth="1" strokeDasharray="3 3" />
        )}

        {/* Emphasised endpoint, ringed against the surface so it reads on top of the line. */}
        <circle cx={x(active)} cy={y(points[active].value)} r="5" fill={MAGNITUDE} stroke="rgb(var(--c-white))" strokeWidth="2" />

        {/* Hit targets are wider than the marks so hovering is forgiving. */}
        {points.map((p, i) => (
          <rect
            key={p.label}
            x={x(i) - (W - padX * 2) / (points.length - 1) / 2}
            y={padTop}
            width={(W - padX * 2) / (points.length - 1)}
            height={plotH}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        {points.map((p, i) => (
          <text
            key={`${p.label}-x`}
            x={x(i)}
            y={H - 6}
            textAnchor="middle"
            className="fill-slate-400"
            style={{ fontSize: 10, fontVariantNumeric: "tabular-nums" }}
          >
            {p.label}
          </text>
        ))}
      </svg>

      <div className="mt-1 text-xs text-slate-500">
        <span className="font-semibold tabular-nums text-slate-800">{points[active].value}</span>{" "}
        {unit} · {points[active].label}
      </div>
    </div>
  );
}
