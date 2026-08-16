import { FormEvent, useState } from "react";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";

import StatusBadge from "../components/ui/StatusBadge";
import TicketPhotos from "../components/features/photos/TicketPhotos";
import SimilarTickets from "../components/features/ai/SimilarTickets";
import WhatFixedIt from "../components/features/ai/WhatFixedIt";
import DeliveryNoteDraft from "../components/features/ai/DeliveryNoteDraft";
import EditTicketModal from "../components/forms/EditTicketModal";
import {
  Button,
  Card,
  Combobox,
  Field,
  Input,
  Modal,
  Skeleton,
  PageHeader,
  Select,
} from "../components/ui/primitives";
import { useToast } from "../components/ui/Toast";
import {
  addTicketUpdate,
  cancelTicket,
  draftFollowup,
  recordWorkStarted,
  deleteTicketReport,
  downloadTicketReport,
  getTicket,
  listClaims,
  listMaterials,
  listTeam,
  listTicketReports,
  setCommissioning,
  setTicketBill,
  starTicket,
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

// One spare row in the Work Started step. Several can be added at once; each is either a
// Blue Star claim (raises its own MR) or vendor/supplier arranged.
type SpareRow = {
  source: "bsl" | "non_bsl";
  material_name: string;
  uom: string;
  qty: number;
  in_stock: boolean;
  mr_no: string;
  technician_id: string;
  vendor: string;
};

const newSpare = (source: SpareRow["source"] = "bsl"): SpareRow => ({
  source,
  material_name: "",
  uom: "Nos",
  qty: 1,
  in_stock: false,
  mr_no: "",
  technician_id: "",
  vendor: "",
});

const EMPTY = {
  action_date: today(),
  job_lead: "",
  helpers: [] as number[],
  complaints: "",
  materials: "",
  remarks: "",
  spares: [] as SpareRow[],
  closeNow: false,
  end_date: today(),
  // reopen
  reopen_reason: "",
};

export default function TicketDetail() {
  const { id } = useParams();
  const { canEditTasks, isAdmin, isPrivileged } = useAuth();
  const [editOpen, setEditOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const toast = useToast();
  const ticketId = Number(id);

  const [ticket, setTicket] = useState<TD | null>(null);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [materials, setMaterials] = useState<MaterialItem[]>([]);
  const [claims, setClaims] = useState<MaterialClaim[]>([]);
  const [reports, setReports] = useState<TicketReport[]>([]);
  const [uploading, setUploading] = useState(false);
  const [f, setF] = useState({ ...EMPTY });
  const [error, setError] = useState<string | null>(null);
  // Work-stage crew (item 4/5). `sameTeam` reuses the previous stage's team with one tick;
  // untick to edit `workTeam` explicitly.
  const [sameTeam, setSameTeam] = useState(true);
  const [workTeam, setWorkTeam] = useState<number[]>([]);

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
      toast.success("Report uploaded", file.name);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error("Upload failed", detail);
    } finally {
      setUploading(false);
    }
  };

  if (!ticket)
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );

  const technicians = team.filter((t) => t.team_type === "Technician");
  // The generic Reports section excludes commissioning PDFs (those live in the commissioning card).
  const generalReports = reports.filter((r) => r.category !== "commissioning");
  const sorted = ticket.updates;
  const latest = sorted[sorted.length - 1];
  const latestStage = latest?.stage ?? "Logged";

  // The crew from the most recent stage that recorded one — carried forward by default so a
  // technician confirms "same team" with one tick instead of re-selecting every stage.
  const previousTeam = [...sorted].reverse().find((u) => u.team.length > 0)?.team ?? [];
  const previousTeamIds = previousTeam.map((m) => m.id);
  // The ids that will actually be submitted for a work stage.
  const effectiveTeam = sameTeam ? previousTeamIds : workTeam;
  const isClosed = ticket.status === "Closed";
  const isAssigned = !!ticket.is_assigned;

  // Any Blue Star spare means a claim is raised, so the ticket goes to Material Pending
  // (and can't be closed in the same action).
  const bslCount = f.spares.filter((s) => s.source === "bsl").length;
  const hasBsl = bslCount > 0;

  // Absolute URL to the phone-first view (respects the app's deployed base path).
  const mobileUrl =
    `${window.location.origin}${import.meta.env.BASE_URL.replace(/\/$/, "")}/m/ticket/${ticket.id}`;

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
      toast.success("Ticket updated");
    } catch (err: unknown) {
      const detail =
        (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error("Couldn't save the update", detail);
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
    if (f.spares.some((s) => !s.material_name.trim())) {
      setError("Every spare needs a material name (or remove the empty row)");
      return;
    }
    // One atomic call: raises a Blue Star claim per BSL spare (saving new materials to the
    // catalog), records non-BSL spares on the lifecycle row, and writes a single stage row.
    wrap(() =>
      recordWorkStarted(ticketId, {
        action_date: f.action_date || null,
        remarks: f.remarks || null,
        close_now: f.closeNow,
        end_date: f.end_date || null,
        team_ids: effectiveTeam,
        spares: f.spares.map((s) => ({
          source: s.source,
          material_name: s.material_name.trim(),
          uom: s.uom || "Nos",
          qty: Number(s.qty) || 1,
          in_stock: s.source === "bsl" ? s.in_stock : false,
          mr_no: s.source === "bsl" ? (s.mr_no || null) : null,
          technician_id:
            s.source === "bsl" && s.technician_id ? Number(s.technician_id) : null,
          vendor: s.source === "non_bsl" ? (s.vendor || null) : null,
        })),
      }).then(() => undefined),
    );
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
            {ticket.mr_pending && (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
                MR Pending
              </span>
            )}
            {ticket.balance != null && ticket.balance > 0 && (
              <span className="rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-medium text-rose-700">
                Payment Pending
              </span>
            )}
            <StatusBadge status={ticket.status} />
            {isPrivileged && (
              <button
                onClick={async () => {
                  try {
                    const t = await starTicket(ticket.id, !ticket.starred);
                    setTicket(t);
                    toast.success(t.starred ? "Marked important" : "Unmarked important");
                  } catch (err) {
                    const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                    toast.error("Couldn't update", detail);
                  }
                }}
                title={ticket.starred ? "Unmark as important" : "Mark as important"}
                className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
                  ticket.starred
                    ? "border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                    : "border-slate-300 text-slate-700 hover:bg-slate-50"
                }`}
              >
                {ticket.starred ? "★ Important" : "☆ Mark important"}
              </button>
            )}
            {isPrivileged && (
              <button
                onClick={() => setEditOpen(true)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                ✎ Edit
              </button>
            )}
            {isAdmin && !ticket.mr_pending &&
              ticket.status !== "Closed" && ticket.status !== "Cancelled" && (
              <button
                onClick={() => { setCancelReason(""); setCancelOpen(true); }}
                className="rounded-md border border-rose-300 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-50"
              >
                Cancel ticket
              </button>
            )}
            <DeliveryNoteDraft ticketId={ticketId} />
            <Link
              to={`/tickets/${ticket.id}/print`}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              🖨 Service report
            </Link>
          </div>
        }
      />

      <EditTicketModal
        ticket={ticket}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={(t) => setTicket(t)}
      />

      <Modal open={cancelOpen} title={`Cancel ${ticket.ticket_no}`} onClose={() => setCancelOpen(false)}>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            This cancels the ticket. Its number is kept (never reused) and it can't be reopened.
          </p>
          <Field label="Reason *">
            <Input value={cancelReason} autoFocus
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Why is this ticket being cancelled?" />
          </Field>
          <div className="flex gap-2">
            <Button
              disabled={cancelling || !cancelReason.trim()}
              onClick={async () => {
                setCancelling(true);
                try {
                  const t = await cancelTicket(ticket.id, cancelReason.trim());
                  setTicket(t);
                  toast.success("Ticket cancelled");
                  setCancelOpen(false);
                } catch (err) {
                  const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
                  toast.error("Couldn't cancel the ticket", detail);
                } finally {
                  setCancelling(false);
                }
              }}
            >
              {cancelling ? "Cancelling…" : "Cancel ticket"}
            </Button>
            <Button variant="ghost" onClick={() => setCancelOpen(false)}>Keep ticket</Button>
          </div>
        </div>
      </Modal>

      {ticket.status === "Cancelled" && ticket.cancel_reason && (
        <div className="mb-6 rounded-md border border-slate-300 bg-slate-100 px-4 py-2 text-sm text-slate-700">
          <span className="font-medium">Cancelled</span> — {ticket.cancel_reason}
        </div>
      )}

      {ticket.edits && ticket.edits.length > 0 && (
        <Card className="mb-6">
          <h2 className="mb-2 font-semibold text-slate-700">Edit history</h2>
          <ul className="space-y-1 text-sm">
            {ticket.edits.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-2">
                <span className="text-slate-700">{e.note}</span>
                <span className="text-xs text-slate-400">
                  {e.edited_by_name ?? "—"} · {new Date(e.edited_at).toLocaleString("en-IN")}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

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

      {ticket.work_type === "Repaired Service" && (
        <BillingCard ticket={ticket} canEdit={isPrivileged} onSaved={setTicket} />
      )}

      {ticket.is_commissioning && (
        <CommissioningCard
          ticket={ticket}
          canEdit={canEditTasks}
          canUpload={isAdmin}
          reports={reports.filter((r) => r.category === "commissioning")}
          onSaved={setTicket}
          onReportsChanged={() => listTicketReports(ticketId).then(setReports)}
        />
      )}

      <Card className="mb-6 flex items-center gap-4">
        <QRCodeSVG value={mobileUrl} size={92} />
        <div className="text-sm">
          <div className="font-medium text-slate-700">Open this job on a phone</div>
          <div className="text-xs text-slate-400">Scan the QR, or open:</div>
          <a
            href={mobileUrl}
            target="_blank"
            rel="noreferrer"
            className="break-all text-xs text-sky-600 hover:underline"
          >
            {mobileUrl}
          </a>
        </div>
      </Card>

      {canEditTasks && <FollowupDrafter ticketId={ticketId} hasTotal={ticket.total_amount != null} />}

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
                {generalReports.length}
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
              {generalReports.map((r) => (
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
              {generalReports.length === 0 && <p className="text-sm text-slate-400">No reports uploaded.</p>}
            </div>
          </div>
        </div>

        <TicketPhotos ticketId={ticketId} />

        <SimilarTickets ticketId={ticketId} />

        <WhatFixedIt ticketId={ticketId} />


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
                  <Combobox
                    placeholder="Search technician…"
                    value={f.job_lead}
                    onChange={(v) => setF({ ...f, job_lead: v })}
                    options={technicians.map((t) => ({
                      value: String(t.id),
                      label: t.name,
                      hint: t.skills || undefined,
                    }))}
                  />
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

                {/* Team on site for this stage — reuse the previous crew with one tick. */}
                <div className="rounded-md border border-slate-200 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-600">Team on site</span>
                    {previousTeam.length > 0 && (
                      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-slate-600">
                        <input type="checkbox" checked={sameTeam}
                          onChange={(e) => {
                            setSameTeam(e.target.checked);
                            if (!e.target.checked) setWorkTeam(previousTeamIds);
                          }} />
                        Same team as before
                      </label>
                    )}
                  </div>

                  {sameTeam && previousTeam.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {previousTeam.map((m) => (
                        <span key={m.id}
                          className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-700">
                          {m.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <select multiple
                      className="h-28 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
                      value={(sameTeam ? previousTeamIds : workTeam).map(String)}
                      onChange={(e) => {
                        setSameTeam(false);
                        setWorkTeam(Array.from(e.target.selectedOptions, (o) => Number(o.value)));
                      }}>
                      {team.map((m) => (
                        <option key={m.id} value={m.id}>{m.name} ({m.team_type})</option>
                      ))}
                    </select>
                  )}
                  {previousTeam.length === 0 && (
                    <p className="mt-1 text-xs text-slate-400">
                      No team was recorded at assignment — pick who is on site now.
                    </p>
                  )}
                </div>

                {/* Spares used — add as many as needed, each BSL or Non-BSL */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-600">Spares used</span>
                    <button type="button"
                      onClick={() => setF((p) => ({ ...p, spares: [...p.spares, newSpare()] }))}
                      className="text-xs font-medium text-sky-600 hover:underline">
                      + Add spare
                    </button>
                  </div>

                  {f.spares.length === 0 && (
                    <p className="rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-500">
                      No spares — records Work Started with materials “None”.
                    </p>
                  )}

                  {f.spares.map((s, i) => {
                    const set = (patch: Partial<SpareRow>) =>
                      setF((p) => ({
                        ...p,
                        spares: p.spares.map((x, j) => (j === i ? { ...x, ...patch } : x)),
                      }));
                    return (
                      <div key={i} className="space-y-2 rounded-md bg-slate-50 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-500">Spare {i + 1}</span>
                          <button type="button"
                            onClick={() => setF((p) => ({ ...p, spares: p.spares.filter((_, j) => j !== i) }))}
                            className="text-xs text-rose-600 hover:underline">
                            Remove
                          </button>
                        </div>

                        <Field label="Source">
                          <Select value={s.source}
                            onChange={(e) => set({ source: e.target.value as SpareRow["source"] })}>
                            <option value="bsl">Blue Star claim → BSL MR Pending</option>
                            <option value="non_bsl">Non-Blue-Star → Vendor/Supplier</option>
                          </Select>
                        </Field>

                        <Field label="Material — pick or type">
                          <Input
                            list="bsl-materials"
                            value={s.material_name}
                            placeholder="Select or type a material…"
                            onChange={(e) => {
                              const m = materials.find((x) => x.name === e.target.value);
                              set({ material_name: e.target.value, uom: m?.uom ?? s.uom });
                            }}
                          />
                        </Field>

                        <div className="grid grid-cols-2 gap-2">
                          <Field label="Qty">
                            <Input type="number" min={0} value={s.qty}
                              onChange={(e) => set({ qty: Number(e.target.value) })} />
                          </Field>
                          <Field label="UoM">
                            <Input value={s.uom} onChange={(e) => set({ uom: e.target.value })} />
                          </Field>
                        </div>

                        {s.source === "bsl" ? (
                          <>
                            <Field label="SAP MR Number">
                              <Input value={s.mr_no} placeholder="SAP Material Request no."
                                onChange={(e) => set({ mr_no: e.target.value })} />
                            </Field>
                            <Field label="Responsible technician">
                              <Select value={s.technician_id}
                                onChange={(e) => set({ technician_id: e.target.value })}>
                                <option value="">—</option>
                                {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                              </Select>
                            </Field>
                            <label className="flex items-center gap-2 text-sm">
                              <input type="checkbox" checked={s.in_stock}
                                onChange={(e) => set({ in_stock: e.target.checked })} />
                              In hand / in stock (use now, claim &amp; replenish later)
                            </label>
                          </>
                        ) : (
                          <Field label="Vendor / Supplier (optional)">
                            <Input value={s.vendor} placeholder="Vendor or supplier name"
                              onChange={(e) => set({ vendor: e.target.value })} />
                          </Field>
                        )}
                      </div>
                    );
                  })}
                  <datalist id="bsl-materials">
                    {materials.map((m) => <option key={m.id} value={m.name} />)}
                  </datalist>
                </div>

                <Field label="Contents / remarks">
                  <Input value={f.remarks}
                    onChange={(e) => setF({ ...f, remarks: e.target.value })} />
                </Field>

                {!hasBsl && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={f.closeNow}
                      onChange={(e) => setF({ ...f, closeNow: e.target.checked })} />
                    Close ticket now
                  </label>
                )}
                {!hasBsl && f.closeNow && (
                  <Field label="Close date">
                    <Input type="date" value={f.end_date}
                      onChange={(e) => setF({ ...f, end_date: e.target.value })} />
                  </Field>
                )}

                <Button type="submit">
                  {hasBsl
                    ? `Raise ${bslCount} claim${bslCount > 1 ? "s" : ""} → Material Pending`
                    : "Record Work Started"}
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

function BillingCard({
  ticket,
  canEdit,
  onSaved,
}: {
  ticket: TD;
  canEdit: boolean;
  onSaved: (t: TD) => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [billNo, setBillNo] = useState(ticket.bill_no ?? "");
  const [billDate, setBillDate] = useState(ticket.bill_date ?? "");
  const [remarks, setRemarks] = useState(ticket.bill_remarks ?? "");
  const [saving, setSaving] = useState(false);

  const open = () => {
    setBillNo(ticket.bill_no ?? "");
    setBillDate(ticket.bill_date ?? "");
    setRemarks(ticket.bill_remarks ?? "");
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const t = await setTicketBill(ticket.id, {
        bill_no: billNo.trim() || null,
        bill_date: billDate || null,
        bill_remarks: remarks.trim() || null,
      });
      onSaved(t);
      toast.success(billNo.trim() ? "Bill saved" : "Billing cleared");
      setEditing(false);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error("Couldn't save billing", detail);
    } finally {
      setSaving(false);
    }
  };

  const billed = !!ticket.bill_no;

  return (
    <Card className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold text-slate-700">Billing</h2>
        {canEdit && (
          <button onClick={open}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50">
            {billed ? "Edit bill" : "Add bill"}
          </button>
        )}
      </div>
      {billed ? (
        <div className="grid grid-cols-2 gap-y-2 text-sm md:grid-cols-4">
          <Meta label="Bill no." value={ticket.bill_no ?? "—"} />
          <Meta label="Bill date" value={ticket.bill_date ?? "—"} />
          <Meta label="Remarks" value={ticket.bill_remarks ?? "—"} />
        </div>
      ) : (
        <p className="text-sm text-slate-400">Not billed yet.</p>
      )}

      <Modal open={editing} title={`Billing — ${ticket.ticket_no}`} onClose={() => setEditing(false)}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bill number">
              <Input value={billNo} autoFocus placeholder="e.g. INV-2026-0042"
                onChange={(e) => setBillNo(e.target.value)} />
            </Field>
            <Field label="Bill date">
              <Input type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} />
            </Field>
          </div>
          <Field label="Remarks">
            <Input value={remarks} onChange={(e) => setRemarks(e.target.value)} />
          </Field>
          <p className="text-xs text-slate-400">
            The bill drives the outstanding balance and payment follow-up on the Payments page.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save bill"}</Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function CommissioningCard({
  ticket,
  canEdit,
  canUpload,
  reports,
  onSaved,
  onReportsChanged,
}: {
  ticket: TD;
  canEdit: boolean;
  canUpload: boolean;
  reports: TicketReport[];
  onSaved: (t: TD) => void;
  onReportsChanged: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState(ticket.commissioning_status ?? "");
  const [remarks, setRemarks] = useState(ticket.commissioning_remarks ?? "");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const open = () => {
    setStatus(ticket.commissioning_status ?? "");
    setRemarks(ticket.commissioning_remarks ?? "");
    setEditing(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const t = await setCommissioning(ticket.id, {
        status: status.trim() || null,
        remarks: remarks.trim() || null,
      });
      onSaved(t);
      toast.success("Installation report saved");
      setEditing(false);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error("Couldn't save the report", detail);
    } finally {
      setSaving(false);
    }
  };

  const onUpload = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      await uploadTicketReport(ticket.id, file, "commissioning");
      onReportsChanged();
      toast.success("Installation PDF uploaded", file.name);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      toast.error("Upload failed", detail);
    } finally {
      setUploading(false);
    }
  };

  const filled = !!(ticket.commissioning_status || ticket.commissioning_remarks);

  return (
    <Card className="mb-6 border-sky-200 bg-sky-50/40">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-semibold text-slate-700">Installation / Commissioning report</h2>
        {canEdit && (
          <button onClick={open}
            className="rounded-md border border-slate-300 px-3 py-1 text-xs font-medium text-slate-700 hover:bg-white">
            {filled ? "Edit report" : "Add report"}
          </button>
        )}
      </div>

      {filled ? (
        <div className="grid grid-cols-1 gap-y-2 text-sm md:grid-cols-2">
          <Meta label="Status" value={ticket.commissioning_status ?? "—"} />
          <Meta label="Remarks" value={ticket.commissioning_remarks ?? "—"} />
        </div>
      ) : (
        <p className="text-sm text-slate-400">No installation report recorded yet.</p>
      )}

      {/* Installation PDFs */}
      <div className="mt-4 border-t border-sky-100 pt-3">
        <div className="mb-2 flex items-center gap-3">
          <span className="text-sm font-medium text-slate-600">Installation PDFs</span>
          <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600">
            {reports.length}
          </span>
          {canUpload && (
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs hover:bg-slate-50">
              <input type="file" accept="application/pdf,.pdf" className="hidden"
                onChange={(e) => { onUpload(e.target.files?.[0]); e.target.value = ""; }} />
              {uploading ? "Uploading…" : "⬆ Upload PDF"}
            </label>
          )}
        </div>
        <div className="space-y-2">
          {reports.map((r) => (
            <div key={r.id}
              className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <div>
                <button onClick={() => downloadTicketReport(ticket.id, r.id, r.original_name)}
                  className="font-medium text-sky-600 hover:underline">📄 {r.original_name}</button>
                <div className="text-xs text-slate-400">
                  {(r.size / 1024).toFixed(0)} KB · {r.uploaded_by_name ?? "—"} ·{" "}
                  {new Date(r.uploaded_at).toLocaleString()}
                </div>
              </div>
              {canUpload && (
                <button
                  onClick={() => {
                    if (window.confirm("Delete this PDF?"))
                      deleteTicketReport(ticket.id, r.id).then(onReportsChanged);
                  }}
                  className="text-xs font-medium text-rose-600 hover:underline">
                  Delete
                </button>
              )}
            </div>
          ))}
          {reports.length === 0 && <p className="text-sm text-slate-400">No installation PDFs uploaded.</p>}
        </div>
      </div>

      <Modal open={editing} title={`Installation report — ${ticket.ticket_no}`} onClose={() => setEditing(false)}>
        <div className="space-y-3">
          <Field label="Status">
            <Input value={status} autoFocus placeholder="e.g. Installed & running / Pending trial"
              onChange={(e) => setStatus(e.target.value)} />
          </Field>
          <Field label="Remarks">
            <textarea
              className="h-24 w-full rounded-md border border-slate-300 p-2 text-sm focus:border-slate-500 focus:outline-none"
              value={remarks} onChange={(e) => setRemarks(e.target.value)}
              placeholder="Commissioning notes…" />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save report"}</Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

function FollowupDrafter({ ticketId, hasTotal }: { ticketId: number; hasTotal: boolean }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [copied, setCopied] = useState(false);

  const gen = async (kind: "payment_reminder" | "status_update") => {
    setLoading(kind);
    try {
      const d = await draftFollowup(ticketId, kind);
      setText(d.text);
      setOpen(true);
      setCopied(false);
    } finally {
      setLoading(null);
    }
  };

  return (
    <Card className="mb-6">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium text-slate-700">Draft follow-up:</span>
        <Button variant="ghost" onClick={() => gen("status_update")} disabled={!!loading}>
          {loading === "status_update" ? "Drafting…" : "Status update"}
        </Button>
        {hasTotal && (
          <Button variant="ghost" onClick={() => gen("payment_reminder")} disabled={!!loading}>
            {loading === "payment_reminder" ? "Drafting…" : "Payment reminder"}
          </Button>
        )}
        <span className="text-xs text-slate-400">AI-drafted from live data — review before sending.</span>
      </div>

      <Modal open={open} title="Draft follow-up" onClose={() => setOpen(false)}>
        <textarea
          className="h-48 w-full rounded-md border border-slate-300 p-3 text-sm focus:border-slate-500 focus:outline-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
          <Button
            onClick={() => { navigator.clipboard?.writeText(text); setCopied(true); }}
          >
            {copied ? "Copied ✓" : "Copy"}
          </Button>
        </div>
      </Modal>
    </Card>
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
