import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import { getTicket } from "../api/services";
import type { TicketDetail as TD } from "../types";

/**
 * Printable job sheet for one ticket (route: /tickets/:id/print).
 *
 * Uses the browser's own print-to-PDF rather than a server-side PDF library — no extra
 * dependency, and the customer gets an identical document either way. Screen chrome is
 * hidden by the print styles below so what prints is only the sheet.
 */
export default function TicketPrint() {
  const { id } = useParams();
  const [t, setT] = useState<TD | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    getTicket(Number(id)).then(setT).catch(() => setError(true));
  }, [id]);

  if (error) return <p className="p-8 text-sm text-rose-600">Couldn't load this ticket.</p>;
  if (!t) return <p className="p-8 text-sm text-slate-400">Preparing report…</p>;

  const ordered = [...(t.updates ?? [])].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
  const lead = [...ordered].reverse().find((u) => u.job_lead)?.job_lead ?? "—";
  const materials = ordered.map((u) => u.materials).filter(Boolean).join("; ") || "Nil";
  const started = ordered.find((u) => u.start_date)?.start_date ?? "—";
  const ended = [...ordered].reverse().find((u) => u.end_date)?.end_date ?? "—";

  return (
    <>
      <style>{`
        @media print {
          /* Hide the app shell so only the sheet prints. */
          aside, nav, .no-print { display: none !important; }
          main { overflow: visible !important; padding: 0 !important; }
          html, body, #root { height: auto !important; background: #fff !important; }
          .print-sheet { box-shadow: none !important; border: 0 !important; margin: 0 !important; }
          @page { size: A4; margin: 14mm; }
        }
      `}</style>

      <div className="no-print mb-4 flex gap-2">
        <button
          onClick={() => window.print()}
          className="rounded-md bg-slate-800 px-4 py-2 text-sm font-medium text-white"
        >
          🖨 Print / Save as PDF
        </button>
        <button
          onClick={() => window.history.back()}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
        >
          Back
        </button>
      </div>

      <div className="print-sheet mx-auto max-w-3xl bg-white p-8 text-slate-900 shadow-sm">
        <header className="mb-6 flex items-start justify-between border-b-2 border-slate-800 pb-3">
          <div>
            <h1 className="text-xl font-bold">Service Report</h1>
            <p className="text-xs text-slate-500">HVAC Service · Job Sheet</p>
          </div>
          <div className="text-right">
            <div className="font-mono text-lg font-bold">{t.ticket_no}</div>
            <div className="text-xs text-slate-500">Status: {t.status}</div>
          </div>
        </header>

        <section className="mb-5 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
          <Row label="Customer" value={t.customer_name ?? "—"} />
          <Row label="Site / City" value={t.customer_city ?? "—"} />
          <Row label="Complaint date" value={t.complaint_date} />
          <Row label="Work type" value={t.work_type} />
          <Row label="Machine" value={t.machine_type ?? "—"} />
          <Row label="Skill" value={t.skill ?? "—"} />
          <Row label="Complaint" value={t.primary_complaint ?? "—"} />
          <Row label="Job lead" value={lead} />
          <Row label="Work started" value={String(started)} />
          <Row label="Work completed" value={String(ended)} />
        </section>

        <section className="mb-5">
          <h2 className="mb-2 border-b border-slate-300 pb-1 text-sm font-bold uppercase tracking-wide">
            Work carried out
          </h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-500">
                <th className="py-1 pr-2">Date</th>
                <th className="py-1 pr-2">Stage</th>
                <th className="py-1 pr-2">By</th>
                <th className="py-1">Remarks</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((u) => (
                <tr key={u.id} className="border-b border-slate-100 align-top">
                  <td className="py-1 pr-2 whitespace-nowrap">{u.action_date ?? "—"}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{u.stage}</td>
                  <td className="py-1 pr-2">{u.job_lead ?? "—"}</td>
                  <td className="py-1">{u.remarks ?? ""}</td>
                </tr>
              ))}
              {ordered.length === 0 && (
                <tr><td colSpan={4} className="py-3 text-center text-slate-400">No entries</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="mb-8">
          <h2 className="mb-2 border-b border-slate-300 pb-1 text-sm font-bold uppercase tracking-wide">
            Materials used
          </h2>
          <p className="text-xs">{materials}</p>
        </section>

        <section className="grid grid-cols-2 gap-12 pt-10 text-xs">
          <SignatureLine caption="Technician" name={lead} />
          <SignatureLine caption="Customer (name & signature)" name="" />
        </section>

        <p className="mt-8 text-center text-[10px] text-slate-400">
          Generated {new Date().toLocaleDateString("en-IN")} · {t.ticket_no}
        </p>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-32 shrink-0 text-slate-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function SignatureLine({ caption, name }: { caption: string; name: string }) {
  return (
    <div>
      <div className="h-10" />
      <div className="border-t border-slate-800 pt-1">
        <div className="font-medium">{name || " "}</div>
        <div className="text-slate-500">{caption}</div>
      </div>
    </div>
  );
}
