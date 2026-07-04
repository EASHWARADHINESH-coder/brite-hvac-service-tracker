import { FormEvent, useState } from "react";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";

import StatusBadge from "../components/ui/StatusBadge";
import {
  Button,
  Card,
  Field,
  Input,
  PageHeader,
  Select,
} from "../components/ui/primitives";
import {
  addTicketUpdate,
  createMaterialPending,
  deleteTicketReport,
  downloadTicketReport,
  getTicket,
  listClaims,
  listMaterials,
  listTeam,
  listTicketReports,
  updateClaim,
  uploadTicketReport,
} from "../api/services";
import { useAuth } from "../context/AuthContext";
import type {
  MaterialClaim,
  MaterialItem,
  TeamMember,
  TicketDetail as TD,
  TicketReport,
} from "../types";

const today = () => new Date().toISOString().slice(0, 10);

// Branch chosen when work begins (Work Started).
type Branch = "none" | "non_bsl" | "bsl";

const EMPTY = {
  action_date: today(),
  job_lead: "",
  helpers: [] as number[],
  complaints: "",
  materials: "",
  remarks: "",
  branch: "none" as Branch,
  closeNow: false,
  end_date: today(),
  vendor: "",  // non-Blue-Star (Vendor/Supplier) branch
  // Blue Star claim (bsl branch)
  claim_material: "",
  claim_uom: "Nos",
  claim_qty: 1,
  claim_in_stock: false,
  claim_mr_no: "",
  claim_tech: "",
  // reopen
  reopen_reason: "",
};

export default function TicketDetail() {
  const { id } = useParams();
  const { canEditTasks, isAdmin } = useAuth();
  const ticketId = Number(id);

  const [ticket, setTicket] = useState<TD | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [claims, setClaims] = useState<MaterialClaim[]>([]);
  const [reports, setReports] = useState<TicketReport[]>([]);
  const [uploading, setUploading] = useState(false);
  const [f, setF] = useState({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    getTicket(ticketId).then(setTicket);
    listClaims({ ticket_id: ticketId }).then(setClaims);
    listTicketReports(ticketId).then(setReports).catch(() => setReports([]));
  };
  useEffect(() => {
    load();
    listTeam().then(setTeam);
    listMaterials().then(setMaterials);
  }, [ticketId]);

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadTicketReport(ticketId, file);
      listTicketReports(ticketId).then(setReports);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  if (!ticket) return <p className="text-slate-400">Loading…</p>;

  const technicians = team.filter((t) => t.team_type === "Technician");
  const sorted = ticket.updates;
  const latest = sorted[sorted.length - 1];
  const latestStage = latest?.stage ?? "Logged";
  const isClosed = ticket.status === "Closed";
  const isAssigned = !!ticket.is_assigned;

  // Which guided step to show next.
  const step: "assign" | "work_started" | "post_work" | "material" | "tc_close" | "reopen" =
    isClosed
      ? "reopen"
      : !isAssigned
        ? "assign"
        : latestStage === "Assigned"
          ? "work_started"
          : latestStage === "Material Pending"
            ? "material"
            : latestStage === "Testing & Commissioning"
              ? "tc_close"
              : "post_work";

  const reset = () => { setF({ ...EMPTY }); setError(null); };
  const afterSave = () => { reset(); load(); };

  const wrap = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      afterSave();
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail ?? "Action failed");
    }
  };

  // ---- step submit handlers ----
  const submitAssign = (e: FormEvent) => {
    e.preventDefault();
    const lead = technicians.find((t) => String(t.id) === f.job_lead);
    const teamIds = Array.from(
      new Set([...(lead?.id ? [lead.id] : []), ...f.helpers]),
    );
    wrap(() =>
      addTicketUpdate(ticketId, {
        stage: "Assigned",
        action_date: f.action_date || null,
        job_lead: lead ? lead.name : f.job_lead || null,
        team_ids: teamIds,
        complaints: f.complaints || null,
        materials: f.materials || null,
        remarks: f.remarks || null,
      }).then(() => undefined),
    );
  };

  const submitWorkStarted = (e: FormEvent) => {
    e.preventDefault();
    if (f.branch === "bsl") {
      if (!f.claim_material.trim()) { setError("Enter the Blue Star material"); return; }
      // One atomic call: creates the claim, saves a new material to the catalog,
      // and moves the ticket to Material Pending.
      wrap(() =>
        createMaterialPending(ticketId, {
          material_name: f.claim_material.trim(),
          uom: f.claim_uom,
          qty: Number(f.claim_qty),
          in_stock: f.claim_in_stock,
          mr_no: f.claim_mr_no || null,  // SAP MR Number
          technician_id: f.claim_tech ? Number(f.claim_tech) : null,
          action_date: f.action_date || null,
          remarks: f.remarks || null,
        }).then(() => undefined),
      );
      return;
    }
    // Source tag recorded in the materials line (None / Vendor-Supplier).
    const materialsNote =
      f.branch === "non_bsl"
        ? `Vendor/Supplier${f.vendor.trim() ? ` (${f.vendor.trim()})` : ""}`
          + `${f.materials.trim() ? ` — ${f.materials.trim()}` : ""}`
        : "None";
    wrap(async () => {
      await addTicketUpdate(ticketId, {
        stage: "Work Started",
        action_date: f.action_date || null,
        materials: materialsNote,
        remarks: f.remarks || null,
      });
      if (f.closeNow) {
        await addTicketUpdate(ticketId, {
          stage: "Closed",
          action_date: f.end_date || today(),
          end_date: f.end_date || today(),
          remarks: f.remarks || null,
        });
      }
    });
  };

  const submitTC = (e: FormEvent) => {
    e.preventDefault();
    wrap(() =>
      addTicketUpdate(ticketId, {
        stage: "Testing & Commissioning",
        action_date: f.action_date || null,
        remarks: f.remarks || null,
      }).then(() => undefined),
    );
  };

  const submitClose = (e: FormEvent) => {
    e.preventDefault();
    wrap(() =>
      addTicketUpdate(ticketId, {
        stage: "Closed",
        action_date: f.end_date || today(),
        end_date: f.end_date || today(),
        complaints: f.complaints || null,
        remarks: f.remarks || null,
      }).then(() => undefined),
    );
  };

  const submitReopen = (e: FormEvent) => {
    e.preventDefault();
    wrap(() =>
      addTicketUpdate(ticketId, {
        stage: "Reopened",
        action_date: f.action_date || null,
        reopen: true,
        reopen_reason: f.reopen_reason || null,
        remarks: f.remarks || null,
      }).then(() => undefined),
    );
  };

  // ---- 72h assignment badge ----
  const assignBadge =
    !isAssigned && ticket.assign_by ? (
      ticket.assignment_overdue ? (
        <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700">
          Assignment overdue (by {ticket.assign_by})
        </span>
      ) : (
        <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
          Assign by {ticket.assign_by} ({daysLeft(ticket.assign_by)})
        </span>
      )
    ) : null;

  const openClaims = claims.filter(
    (c) =>
      c.status === "MR Raised" ||
      c.status === "Material Received" ||
      c.status === "Awaiting Replenishment",
  );

  return (
    <div>
      <PageHeader
        title={ticket.ticket_no}
        action={
          <div className="flex items-center gap-2">
            {assignBadge}
            {ticket.balance != null && ticket.balance > 0 && (
              <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700">
                Payment Pending
              </span>
            )}
            <StatusBadge status={ticket.status} />
          </div>
        }
      />

      <Card className="mb-6">
        <div className="grid grid-cols-2 gap-y-2 text-sm md:grid-cols-4">
          <Meta label="Customer" value={ticket.customer_name ?? "—"} />
          <Meta label="Complaint date" value={ticket.complaint_date} />
          <Meta label="Work type" value={ticket.work_type} />
          <Meta label="Machine" value={ticket.machine_type ?? "—"} />
          <Meta label="Skill" value={ticket.skill ?? "—"} />
          <Meta label="Primary complaint" value={ticket.primary_complaint ?? "—"} />
          {ticket.requires_tc && (
            <Meta label="Testing & Commissioning" value="Required" />
          )}
          {ticket.total_amount != null && (
            <>
              <Meta label="Total ₹" value={`₹${ticket.total_amount.toLocaleString("en-IN")}`} />
              <Meta label="Paid ₹" value={`₹${(ticket.paid_amount ?? 0).toLocaleString("en-IN")}`} />
              <Meta label="Balance ₹" value={`₹${(ticket.balance ?? 0).toLocaleString("en-IN")}`} />
            </>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Lifecycle timeline */}
        <div className="lg:col-span-2 space-y-6">
          <div>
            <h2 className="mb-3 font-semibold text-slate-700">Lifecycle</h2>
            <ol className="relative border-l border-slate-200 pl-6">
              {sorted.map((u) => (
                <li key={u.id} className="mb-6">
                  <span className="absolute -left-1.5 mt-1 h-3 w-3 rounded-full bg-slate-400" />
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{u.stage}</span>
                    {u.reopen && (
                      <span className="rounded bg-rose-100 px-1.5 text-xs text-rose-700">reopen</span>
                    )}
                    <span className="text-xs text-slate-400">{u.action_date ?? ""}</span>
                  </div>
                  {u.job_lead && <div className="text-sm text-slate-500">Lead: {u.job_lead}</div>}
                  {u.team.length > 0 && (
                    <div className="text-sm text-slate-500">
                      Team: {u.team.map((t) => t.name).join(", ")}
                    </div>
                  )}
                  {u.complaints && <div className="text-sm text-slate-500">Complaint: {u.complaints}</div>}
                  {u.materials && <div className="text-sm text-slate-500">Materials: {u.materials}</div>}
                  {u.remarks && <div className="text-sm">{u.remarks}</div>}
                  {u.reopen_reason && (
                    <div className="text-sm text-rose-600">Reopen reason: {u.reopen_reason}</div>
                  )}
                </li>
              ))}
            </ol>
          </div>

          {/* Linked Blue Star claims */}
          {claims.length > 0 && (
            <div>
              <h2 className="mb-3 font-semibold text-slate-700">Blue Star material claims</h2>
              <div className="space-y-3">
                {claims.map((c) => (
                  <ClaimCard
                    key={c.id}
                    claim={c}
                    ticketNo={ticket.ticket_no}
                    canEdit={canEditTasks}
                    onSaved={load}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Manual report PDFs (all tickets) */}
          <div>
            <div className="mb-3 flex items-center gap-3">
              <h2 className="font-semibold text-slate-700">Reports (PDF)</h2>
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                {reports.length}
              </span>
            </div>
            {isAdmin && (
              <label className="mb-3 inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50">
                <input type="file" accept="application/pdf,.pdf" className="hidden"
                  onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ""; }} />
                {uploading ? "Uploading…" : "⬆ Upload PDF report"}
              </label>
            )}
            <div className="space-y-2">
              {reports.map((r) => (
                <div key={r.id}
                  className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2 text-sm">
                  <div>
                    <button onClick={() => downloadTicketReport(ticketId, r.id, r.original_name)}
                      className="font-medium text-sky-600 hover:underline">📄 {r.original_name}</button>
                    <div className="text-xs text-slate-400">
                      {(r.size / 1024).toFixed(0)} KB · {r.uploaded_by_name ?? "—"} ·{" "}
                      {new Date(r.uploaded_at).toLocaleString()}
                    </div>
                  </div>
                  {isAdmin && (
                    <button
                      onClick={() => {
                        if (window.confirm("Delete this report?"))
                          deleteTicketReport(ticketId, r.id).then(() =>
                            listTicketReports(ticketId).then(setReports));
                      }}
                      className="text-xs font-medium text-rose-600 hover:underline">
                      Delete
                    </button>
                  )}
                </div>
              ))}
              {reports.length === 0 && <p className="text-sm text-slate-400">No reports uploaded.</p>}
            </div>
          </div>
        </div>

        {/* Guided action panel — hidden for view-only (Helper) role */}
        {canEditTasks && (
          <Card>
            <h2 className="mb-1 font-semibold text-slate-700">Next step</h2>
            <p className="mb-3 text-xs text-slate-400">Current stage: {latestStage}</p>

            {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}

            {step === "assign" && (
              <form onSubmit={submitAssign} className="space-y-3">
                <p className="text-sm text-slate-500">
                  Assign within 72h to a Lead Technician (manual).
                </p>
                <Field label="Assigned date">
                  <Input type="date" value={f.action_date}
                    onChange={(e) => setF({ ...f, action_date: e.target.value })} />
                </Field>
                <Field label="Job Lead (Lead Technician)">
                  <Select value={f.job_lead}
                    onChange={(e) => setF({ ...f, job_lead: e.target.value })}>
                    <option value="">Select technician…</option>
                    {technicians.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Helpers / support (ctrl/cmd-click for multiple)">
                  <select multiple
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                    value={f.helpers.map(String)}
                    onChange={(e) =>
                      setF({ ...f, helpers: Array.from(e.target.selectedOptions, (o) => Number(o.value)) })
                    }>
                    {team
                      .filter((m) => String(m.id) !== f.job_lead)
                      .map((m) => (
                        <option key={m.id} value={m.id}>{m.name} ({m.team_type})</option>
                      ))}
                  </select>
                </Field>
                <Field label="Materials line (manual)">
                  <Input value={f.materials}
                    onChange={(e) => setF({ ...f, materials: e.target.value })} />
                </Field>
                <Field label="Remarks">
                  <Input value={f.remarks}
                    onChange={(e) => setF({ ...f, remarks: e.target.value })} />
                </Field>
                <Button type="submit">Assign ticket</Button>
              </form>
            )}

            {step === "work_started" && (
              <form onSubmit={submitWorkStarted} className="space-y-3">
                <p className="text-sm text-slate-500">
                  Technician has started work. Choose how materials are handled.
                </p>
                <Field label="Work start date">
                  <Input type="date" value={f.action_date}
                    onChange={(e) => setF({ ...f, action_date: e.target.value })} />
                </Field>
                <Field label="Branch">
                  <Select value={f.branch}
                    onChange={(e) => setF({ ...f, branch: e.target.value as Branch })}>
                    <option value="none">1 · No materials needed → None</option>
                    <option value="non_bsl">2 · Non-Blue-Star arranged → Vendor/Supplier</option>
                    <option value="bsl">3 · Blue Star Claim → BSL MR Pending</option>
                  </Select>
                </Field>

                {f.branch === "non_bsl" && (
                  <>
                    <Field label="Vendor / Supplier (optional)">
                      <Input value={f.vendor} placeholder="Vendor or supplier name"
                        onChange={(e) => setF({ ...f, vendor: e.target.value })} />
                    </Field>
                    <Field label="Materials used">
                      <Input value={f.materials}
                        onChange={(e) => setF({ ...f, materials: e.target.value })} />
                    </Field>
                  </>
                )}

                {f.branch === "bsl" && (
                  <div className="space-y-3 rounded-md bg-slate-50 p-3">
                    <Field label="Material (Blue Star) — pick or type">
                      <Input
                        list="bsl-materials"
                        value={f.claim_material}
                        placeholder="Select or type a material…"
                        onChange={(e) => {
                          const m = materials.find((x) => x.name === e.target.value);
                          setF({ ...f, claim_material: e.target.value, claim_uom: m?.uom ?? f.claim_uom });
                        }}
                      />
                      <datalist id="bsl-materials">
                        {materials.map((m) => <option key={m.id} value={m.name} />)}
                      </datalist>
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="Qty">
                        <Input type="number" min={0} value={f.claim_qty}
                          onChange={(e) => setF({ ...f, claim_qty: Number(e.target.value) })} />
                      </Field>
                      <Field label="UoM">
                        <Input value={f.claim_uom}
                          onChange={(e) => setF({ ...f, claim_uom: e.target.value })} />
                      </Field>
                    </div>
                    <Field label="SAP MR Number">
                      <Input value={f.claim_mr_no} placeholder="SAP Material Request no."
                        onChange={(e) => setF({ ...f, claim_mr_no: e.target.value })} />
                    </Field>
                    <Field label="Responsible technician">
                      <Select value={f.claim_tech}
                        onChange={(e) => setF({ ...f, claim_tech: e.target.value })}>
                        <option value="">—</option>
                        {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </Select>
                    </Field>
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={f.claim_in_stock}
                        onChange={(e) => setF({ ...f, claim_in_stock: e.target.checked })} />
                      Material in hand / in stock (use now, claim & replenish later)
                    </label>
                  </div>
                )}

                <Field label="Contents / remarks">
                  <Input value={f.remarks}
                    onChange={(e) => setF({ ...f, remarks: e.target.value })} />
                </Field>

                {f.branch !== "bsl" && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={f.closeNow}
                      onChange={(e) => setF({ ...f, closeNow: e.target.checked })} />
                    Close ticket now
                  </label>
                )}
                {f.branch !== "bsl" && f.closeNow && (
                  <Field label="Close date">
                    <Input type="date" value={f.end_date}
                      onChange={(e) => setF({ ...f, end_date: e.target.value })} />
                  </Field>
                )}

                <Button type="submit">
                  {f.branch === "bsl" ? "Raise claim → Material Pending" : "Record Work Started"}
                </Button>
              </form>
            )}

            {(step === "post_work" || step === "material") && (
              <div className="space-y-4">
                {step === "material" && openClaims.length > 0 && (
                  <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
                    Resolve the pending Blue Star claim(s) (left) before closing.
                  </p>
                )}

                {ticket.requires_tc && (
                  <form onSubmit={submitTC} className="space-y-2 border-b border-slate-100 pb-4">
                    <p className="text-sm font-medium text-slate-600">
                      Testing &amp; Commissioning (Gas Leakage / Compressor failure)
                    </p>
                    <Field label="Date">
                      <Input type="date" value={f.action_date}
                        onChange={(e) => setF({ ...f, action_date: e.target.value })} />
                    </Field>
                    <Field label="Remarks">
                      <Input value={f.remarks}
                        onChange={(e) => setF({ ...f, remarks: e.target.value })} />
                    </Field>
                    <Button type="submit" variant="ghost">Record T&amp;C</Button>
                  </form>
                )}

                <form onSubmit={submitClose} className="space-y-2">
                  <p className="text-sm font-medium text-slate-600">Close ticket</p>
                  <Field label="Close date">
                    <Input type="date" value={f.end_date}
                      onChange={(e) => setF({ ...f, end_date: e.target.value })} />
                  </Field>
                  <Field label="Contents">
                    <Input value={f.complaints}
                      onChange={(e) => setF({ ...f, complaints: e.target.value })} />
                  </Field>
                  <Field label="Remarks">
                    <Input value={f.remarks}
                      onChange={(e) => setF({ ...f, remarks: e.target.value })} />
                  </Field>
                  <Button type="submit">Close ticket</Button>
                </form>
              </div>
            )}

            {step === "tc_close" && (
              <form onSubmit={submitClose} className="space-y-2">
                <p className="text-sm font-medium text-slate-600">Close ticket</p>
                <Field label="Close date">
                  <Input type="date" value={f.end_date}
                    onChange={(e) => setF({ ...f, end_date: e.target.value })} />
                </Field>
                <Field label="Remarks">
                  <Input value={f.remarks}
                    onChange={(e) => setF({ ...f, remarks: e.target.value })} />
                </Field>
                <Button type="submit">Close ticket</Button>
              </form>
            )}

            {step === "reopen" && (
              <form onSubmit={submitReopen} className="space-y-2">
                <p className="text-sm text-slate-500">Ticket is closed. Reopen if the issue recurs.</p>
                <Field label="Reopen date">
                  <Input type="date" value={f.action_date}
                    onChange={(e) => setF({ ...f, action_date: e.target.value })} />
                </Field>
                <Field label="Reopen reason">
                  <Input value={f.reopen_reason}
                    onChange={(e) => setF({ ...f, reopen_reason: e.target.value })} />
                </Field>
                <Button type="submit">Reopen ticket</Button>
              </form>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}

function daysLeft(dateStr: string): string {
  const diffMs = new Date(dateStr).getTime() - Date.now();
  const days = Math.ceil(diffMs / 86_400_000);
  if (days < 0) return "overdue";
  if (days === 0) return "due today";
  return `${days}d left`;
}

const CLAIM_STEPS: Record<string, string> = {
  "MR Raised": "Awaiting material from BSL / use from stock",
  "Material Received": "Received — fit replacement at site",
  "Awaiting Replenishment": "Used from stock — awaiting BSL replenishment",
  Replaced: "Replaced — return defective to office",
  "Defective in Office": "Defective in office — dispatch to BSL",
  "Dispatched to BSL": "Dispatched to BSL — claim closed",
};

function ClaimCard({
  claim,
  ticketNo,
  canEdit,
  onSaved,
}: {
  claim: MaterialClaim;
  ticketNo: string;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [docNo, setDocNo] = useState("");
  const [d, setD] = useState(today());
  const [busy, setBusy] = useState(false);

  const save = async (patch: Record<string, unknown>) => {
    setBusy(true);
    try {
      await updateClaim(claim.id, patch);
      setDocNo("");
      onSaved();
    } finally {
      setBusy(false);
    }
  };

  const s = claim.status;
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-sm">
      <div className="flex items-center justify-between">
        <span className="font-medium">
          <Link
            to={`/materials?tab=Claims&ticket=${encodeURIComponent(ticketNo)}&claim=${encodeURIComponent(claim.claim_no)}`}
            className="text-sky-600 hover:underline"
            title="Open in Materials → Claims"
          >
            {claim.claim_no}
          </Link>{" "}
          · {claim.material_name} ×{claim.qty} {claim.uom}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{s}</span>
      </div>
      <div className="mt-1 text-xs text-slate-500">{CLAIM_STEPS[s] ?? ""}</div>

      {canEdit && s !== "Dispatched to BSL" && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          {needsDoc(s) && (
            <input
              className="rounded-md border border-slate-300 px-2 py-1 text-xs"
              placeholder={docLabel(s)}
              value={docNo}
              onChange={(e) => setDocNo(e.target.value)}
            />
          )}
          <input
            type="date"
            className="rounded-md border border-slate-300 px-2 py-1 text-xs"
            value={d}
            onChange={(e) => setD(e.target.value)}
          />
          <Button variant="ghost" disabled={busy} onClick={() => save(nextPatch(s, docNo, d))}>
            {nextLabel(s)}
          </Button>
        </div>
      )}
    </div>
  );
}

function needsDoc(s: string): boolean {
  return (
    s === "Defective in Office" ||
    s === "Awaiting Replenishment" ||
    (s === "MR Raised") // received-from-BSL path uses a delivery challan
  );
}

function docLabel(s: string): string {
  if (s === "Defective in Office") return "POD no.";
  return "Delivery Challan no.";
}

function nextLabel(s: string): string {
  switch (s) {
    case "MR Raised": return "Record received / used";
    case "Material Received": return "Mark replaced at site";
    case "Awaiting Replenishment": return "Record BSL replenishment";
    case "Replaced": return "Defective returned to office";
    case "Defective in Office": return "Dispatch to BSL";
    default: return "Update";
  }
}

function nextPatch(s: string, docNo: string, d: string): Record<string, unknown> {
  switch (s) {
    case "MR Raised":
      // Not-in-stock: material received (challan). The compute step derives status.
      return docNo
        ? { delivery_challan_no: docNo, delivery_challan_date: d }
        : { used_date: d };
    case "Material Received":
      return { used_date: d };
    case "Awaiting Replenishment":
      return { delivery_challan_no: docNo, delivery_challan_date: d };
    case "Replaced":
      return { defective_returned_date: d };
    case "Defective in Office":
      return { pod_no: docNo, pod_date: d };
    default:
      return {};
  }
}
