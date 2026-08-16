import { useEffect, useRef, useState } from "react";

import { Card } from "../../ui/primitives";
import { getDailyActivity } from "../../../api/services";
import type { DailyActivity as DA, DailyActivityPoint } from "../../../types";

const WINDOWS = [7, 14, 30] as const;
type Win = (typeof WINDOWS)[number];

type Axis = "left" | "right";
type SeriesDef = { key: keyof DailyActivityPoint; label: string; axis: Axis; color: string; dp: number };

const SERIES: SeriesDef[] = [
  { key: "closed", label: "Calls closed", axis: "left", color: "emerald-600", dp: 0 },
  { key: "backlog", label: "Open backlog", axis: "left", color: "amber-600", dp: 0 },
  { key: "people", label: "People present", axis: "right", color: "blue-600", dp: 0 },
  { key: "per_person", label: "Closed / person", axis: "right", color: "sky-600", dp: 1 },
];

const VBW = 680;
const VBH = 260;
const M = { l: 40, r: 46, t: 14, b: 30 };
const X0 = M.l;
const X1 = VBW - M.r;
const Y0 = M.t;
const Y1 = VBH - M.b;
const col = (name: string) => `rgb(var(--${name}))`;

const shortDate = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
};

/**
 * Daily activity (manpower vs load) — one combined multi-line chart with a dual Y-axis:
 * calls closed + open backlog on the left, people present + closed-per-person on the right.
 * Selectable 7 / 14 / 30-day window; hover for a per-day breakdown.
 */
export default function DailyActivity() {
  const [win, setWin] = useState<Win>(14);
  const [d, setD] = useState<DA | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => { getDailyActivity(win).then(setD).catch(() => setD(null)); }, [win]);
  if (!d || d.scope !== "org") return null;

  const series = d.series ?? [];
  const n = series.length;
  const num = (p: DailyActivityPoint, k: keyof DailyActivityPoint) => Number(p[k]) || 0;

  const leftMax = Math.max(1, ...series.flatMap((p) => [num(p, "closed"), num(p, "backlog")]));
  const rightMax = Math.max(1, ...series.flatMap((p) => [num(p, "people"), num(p, "per_person")]));

  const xAt = (i: number) => (n <= 1 ? (X0 + X1) / 2 : X0 + (i * (X1 - X0)) / (n - 1));
  const yAt = (v: number, axis: Axis) =>
    Y1 - (v / (axis === "left" ? leftMax : rightMax)) * (Y1 - Y0);

  const linePoints = (s: SeriesDef) =>
    series.map((p, i) => `${xAt(i).toFixed(1)},${yAt(num(p, s.key), s.axis).toFixed(1)}`).join(" ");

  const fracs = [0, 0.25, 0.5, 0.75, 1];

  const onMove = (e: React.MouseEvent) => {
    const svg = svgRef.current;
    if (!svg || n === 0) return;
    const rect = svg.getBoundingClientRect();
    const vbx = ((e.clientX - rect.left) / rect.width) * VBW;
    const step = n > 1 ? (X1 - X0) / (n - 1) : 1;
    const idx = Math.max(0, Math.min(n - 1, Math.round((vbx - X0) / step)));
    setHover(idx);
  };

  return (
    <Card className="mb-6">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold text-slate-800">Daily activity</h2>
          <p className="text-xs text-slate-400">Manpower vs load — {d.start} to {d.end}</p>
        </div>
        <div className="flex gap-1 rounded-md border border-slate-200 p-0.5">
          {WINDOWS.map((w) => (
            <button
              key={w}
              onClick={() => { setWin(w); setHover(null); }}
              className={`rounded px-2.5 py-1 text-xs font-medium transition ${
                win === w ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {w}d
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="mb-1 flex flex-wrap gap-x-4 gap-y-1">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-slate-600">
            <span className="inline-block h-2.5 w-3 rounded-sm" style={{ background: col(s.color) }} />
            {s.label}
            <span className="text-[10px] text-slate-400">({s.axis === "left" ? "L" : "R"})</span>
          </span>
        ))}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VBW} ${VBH}`}
        className="w-full"
        style={{ height: "auto" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* horizontal gridlines + dual axis labels */}
        {fracs.map((f) => {
          const y = Y1 - f * (Y1 - Y0);
          return (
            <g key={f}>
              <line x1={X0} y1={y} x2={X1} y2={y} stroke="rgb(var(--slate-200))" strokeWidth={1} />
              <text x={X0 - 6} y={y + 3} textAnchor="end" fontSize="9" fill="rgb(var(--slate-400))">
                {Math.round(leftMax * f)}
              </text>
              <text x={X1 + 6} y={y + 3} textAnchor="start" fontSize="9" fill="rgb(var(--slate-400))">
                {(rightMax * f).toFixed(rightMax < 5 ? 1 : 0)}
              </text>
            </g>
          );
        })}

        {/* x-axis date labels: first, middle, last */}
        {n > 0 && [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map((i) => (
          <text key={i} x={xAt(i)} y={Y1 + 16} textAnchor="middle" fontSize="9" fill="rgb(var(--slate-400))">
            {shortDate(series[i].date)}
          </text>
        ))}

        {/* series lines */}
        {SERIES.map((s) => (
          <polyline
            key={s.key}
            points={linePoints(s)}
            fill="none"
            stroke={col(s.color)}
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}

        {/* hover guide + dots + tooltip */}
        {hover !== null && series[hover] && (() => {
          const hx = xAt(hover);
          const tipW = 150;
          const tipH = 86;
          const tx = hx + 10 + tipW > X1 ? hx - 10 - tipW : hx + 10;
          const p = series[hover];
          return (
            <g>
              <line x1={hx} y1={Y0} x2={hx} y2={Y1} stroke="rgb(var(--slate-300))" strokeWidth={1} strokeDasharray="3 3" />
              {SERIES.map((s) => (
                <circle key={s.key} cx={hx} cy={yAt(num(p, s.key), s.axis)} r={3} fill={col(s.color)} />
              ))}
              <rect x={tx} y={Y0 + 2} width={tipW} height={tipH} rx={6} fill="rgb(var(--c-white))" stroke="rgb(var(--slate-200))" />
              <text x={tx + 8} y={Y0 + 16} fontSize="10" fontWeight="600" fill="rgb(var(--slate-800))">
                {shortDate(p.date)}
              </text>
              {SERIES.map((s, k) => {
                const ry = Y0 + 30 + k * 14;
                return (
                  <g key={s.key}>
                    <rect x={tx + 8} y={ry - 7} width={9} height={9} rx={2} fill={col(s.color)} />
                    <text x={tx + 21} y={ry} fontSize="10" fill="rgb(var(--slate-600))">{s.label}</text>
                    <text x={tx + tipW - 8} y={ry} textAnchor="end" fontSize="10" fontWeight="600" fill="rgb(var(--slate-800))">
                      {num(p, s.key).toFixed(s.dp)}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })()}
      </svg>
      <p className="mt-1 text-center text-[10px] text-slate-400">
        Left axis: calls closed &amp; open backlog · Right axis: people present &amp; closed / person
      </p>
    </Card>
  );
}
