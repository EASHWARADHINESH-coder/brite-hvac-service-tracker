import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Card, PageHeader, Table } from "../components/ui/primitives";
import StatusBadge from "../components/ui/StatusBadge";
import { getTeamMember, memberTickets } from "../api/services";
import type { TeamMember, Ticket } from "../types";

const splitSkills = (s?: string | null): string[] =>
  (s ?? "").split(",").map((x) => x.trim()).filter(Boolean);

export default function TeamMemberDetail() {
  const { id } = useParams();
  const memberId = Number(id);

  const [member, setMember] = useState<TeamMember | null>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!memberId) return;
    setLoading(true);
    Promise.all([getTeamMember(memberId), memberTickets(memberId)])
      .then(([m, t]) => { setMember(m); setTickets(t); })
      .catch((e) => setError(e?.response?.data?.detail ?? "Could not load team member."))
      .finally(() => setLoading(false));
  }, [memberId]);

  if (loading) return <p className="text-slate-400">Loading…</p>;
  if (error || !member)
    return (
      <div>
        <Link to="/team" className="text-sm text-slate-500 hover:underline">← Back to team</Link>
        <p className="mt-4 text-rose-600">{error ?? "Team member not found."}</p>
      </div>
    );

  const skills = splitSkills(member.skills);
  const openCount = tickets.filter((t) => t.status !== "Closed").length;
  const closedCount = tickets.filter((t) => t.status === "Closed").length;

  return (
    <div>
      <Link to="/team" className="text-sm text-slate-500 hover:underline">← Back to team</Link>
      <PageHeader title={member.name} />

      {/* Info */}
      <Card className="mb-6">
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Category" value={member.team_type} />
          <Info label="Experience (Yrs)" value={member.years_experience != null ? String(member.years_experience) : null} />
          <Info label="Mobile" value={member.mobile} />
          <Info label="Email" value={member.email} />
          <div className="sm:col-span-2 lg:col-span-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Skills</p>
            {skills.length ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {skills.map((s) => (
                  <span key={s} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{s}</span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-slate-800">—</p>
            )}
          </div>
        </div>
      </Card>

      {/* Insights placeholder — per-person work analytics (future) */}
      <div className="mb-6 grid grid-cols-3 gap-4">
        <Stat label="Total jobs" value={tickets.length} />
        <Stat label="Open / In progress" value={openCount} />
        <Stat label="Closed" value={closedCount} />
      </div>
      <Card className="mb-8 border-dashed bg-slate-50/50">
        <p className="text-sm font-medium text-slate-600">Insights</p>
        <p className="mt-1 text-sm text-slate-400">
          Per-person work analytics (resolution time, jobs by machine type/skill, mobile activity)
          will appear here.
        </p>
      </Card>

      {/* Assigned tickets */}
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold text-slate-800">Assigned tickets</h2>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
          {tickets.length}
        </span>
      </div>
      <Table head={["Ticket No", "Work type", "Machine", "Complaint date", "Status"]}>
        {tickets.map((t) => (
          <tr key={t.id}>
            <td className="px-4 py-2 font-mono font-medium">
              <Link to={`/tickets/${t.id}`} className="text-slate-800 hover:underline">{t.ticket_no}</Link>
            </td>
            <td className="px-4 py-2">{t.work_type}</td>
            <td className="px-4 py-2">{t.machine_type}</td>
            <td className="px-4 py-2">{t.complaint_date}</td>
            <td className="px-4 py-2"><StatusBadge status={t.status} /></td>
          </tr>
        ))}
        {tickets.length === 0 && (
          <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No tickets assigned to this person</td></tr>
        )}
      </Table>
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-sm text-slate-800">{value || "—"}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-800">{value}</p>
    </Card>
  );
}
