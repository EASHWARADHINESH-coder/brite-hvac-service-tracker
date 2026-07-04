import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Button, Card, Field, Input, Modal, Select, Table } from "../../ui/primitives";
import {
  createClaim,
  exportClaims,
  getDefectiveStock,
  listClaims,
  listMaterials,
  listTeam,
  listTickets,
  listUsers,
  updateClaim,
} from "../../../api/services";

const CLAIM_STATUSES: ClaimStatus[] = [
  "MR Raised", "Material Received", "Awaiting Replenishment",
  "Replaced", "Defective in Office", "Dispatched to BSL",
];
import type {
  AppUser,
  ClaimStatus,
  DefectiveStockRow,
  MaterialClaim,
  MaterialItem,
  TeamMember,
  Ticket,
} from "../../../types";

const today = () => new Date().toISOString().slice(0, 10);

const STATUS_STYLES: Record<ClaimStatus, string> = {
  "MR Raised": "bg-slate-100 text-slate-700",
  "Material Received": "bg-blue-100 text-blue-800",
  "Awaiting Replenishment": "bg-amber-100 text-amber-800",
  Replaced: "bg-violet-100 text-violet-800",
  "Defective in Office": "bg-orange-100 text-orange-800",
  "Dispatched to BSL": "bg-emerald-100 text-emerald-800",
};

function ClaimBadge({ status }: { status: ClaimStatus }) {
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>
      {status}
    </span>
  );
}

// Field metadata for the action modal.
type ActionField = "used_date" | "delivery_challan_no" | "delivery_challan_date"
  | "defective_returned_date" | "pod_no" | "pod_date";

const FIELD_META: Record<ActionField, { label: string; type: "text" | "date" }> = {
  used_date: { label: "Used / replacement date", type: "date" },
  delivery_challan_no: { label: "Delivery Challan No", type: "text" },
  delivery_challan_date: { label: "Delivery Challan date", type: "date" },
  defective_returned_date: { label: "Defective returned date", type: "date" },
  pod_no: { label: "POD No", type: "text" },
  pod_date: { label: "POD date", type: "date" },
};

type Action = { key: string; label: string; fields: ActionField[] } | null;

// Next milestone available for a claim, given its path (in_stock) and recorded fields.
function nextAction(c: MaterialClaim): Action {
  if (c.pod_no) return null; // dispatched / closed
  if (c.defective_returned_date)
    return { key: "dispatch", label: "Dispatch to BSL (POD)", fields: ["pod_no", "pod_date"] };
  const replaced = !!c.used_date && (!c.in_stock || !!c.delivery_challan_no);
  if (replaced)
    return { key: "return", label: "Return defective to office", fields: ["defective_returned_date"] };
  if (c.in_stock) {
    if (!c.used_date)
      return { key: "use", label: "Use from stock", fields: ["used_date"] };
    return {
      key: "replenish",
      label: "Record BSL replacement (Challan)",
      fields: ["delivery_challan_no", "delivery_challan_date"],
    };
  }
  if (!c.delivery_challan_no)
    return {
      key: "receive",
      label: "Record material received (Challan)",
      fields: ["delivery_challan_no", "delivery_challan_date"],
    };
  return { key: "use", label: "Mark replacement done", fields: ["used_date"] };
}

export default function ClaimsTab() {
  const [claims, setClaims] = useState<MaterialClaim[]>([]);
  const [defective, setDefective] = useState<DefectiveStockRow[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [catalog, setCatalog] = useState<MaterialItem[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [banner, setBanner] = useState<string | null>(null);

  // create form
  const [form, setForm] = useState({
    ticket_id: "", material_name: "", uom: "", qty: "", in_stock: false,
    engineer_user_id: "", technician_id: "", mr_no: "",
  });

  // action modal
  const [actionClaim, setActionClaim] = useState<MaterialClaim | null>(null);
  const [action, setAction] = useState<Action>(null);
  const [actionValues, setActionValues] = useState<Record<string, string>>({});

  // filters + export
  const [fStart, setFStart] = useState("");
  const [fEnd, setFEnd] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fTicket, setFTicket] = useState("");
  const [exporting, setExporting] = useState(false);

  // Deep-link from a ticket: ?ticket=<no>&claim=<no> filters + highlights a claim.
  const [searchParams] = useSearchParams();
  const [highlight, setHighlight] = useState<string | null>(null);
  const highlightRef = useRef<HTMLTableRowElement | null>(null);

  const load = () => {
    listClaims().then(setClaims);
    getDefectiveStock().then(setDefective);
  };
  useEffect(() => {
    load();
    listTickets().then(setTickets);
    listMaterials().then(setCatalog);
    listTeam().then(setTeam);
    listUsers().then(setUsers).catch(() => setUsers([]));
  }, []);

  // Apply deep-link params once.
  useEffect(() => {
    const t = searchParams.get("ticket");
    const c = searchParams.get("claim");
    if (t) setFTicket(t);
    if (c) setHighlight(c);
  }, [searchParams]);

  // Scroll the highlighted claim into view once claims are loaded.
  useEffect(() => {
    if (highlight && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlight, claims]);

  const engineers = useMemo(
    () => users.filter((u) => u.is_active && (u.role === "Service Engineer" || u.role === "Service Admin")),
    [users],
  );
  const ticketNo = (id: number) => tickets.find((t) => t.id === id)?.ticket_no ?? id;
  const engName = (id?: number | null) =>
    id ? users.find((u) => u.id === id)?.full_name ?? users.find((u) => u.id === id)?.username ?? "—" : "—";
  const techName = (id?: number | null) => (id ? team.find((t) => t.id === id)?.name ?? "—" : "—");

  // Client-side filtering for the displayed claims list.
  const filteredClaims = claims.filter((c) => {
    if (fStart && c.mr_date < fStart) return false;
    if (fEnd && c.mr_date > fEnd) return false;
    if (fStatus && c.status !== fStatus) return false;
    if (fTicket && !String(ticketNo(c.ticket_id)).toLowerCase().includes(fTicket.toLowerCase()))
      return false;
    return true;
  });

  const doExport = async () => {
    setExporting(true);
    try {
      await exportClaims({ start: fStart, end: fEnd, status: fStatus, ticket_no: fTicket });
    } finally {
      setExporting(false);
    }
  };

  const submitCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.ticket_id || !form.material_name || !form.qty) {
      setBanner("Ticket, material and quantity are required.");
      return;
    }
    setBanner(null);
    try {
      await createClaim({
        ticket_id: Number(form.ticket_id),
        material_name: form.material_name,
        uom: form.uom || "Nos",
        qty: Number(form.qty),
        in_stock: form.in_stock,
        engineer_user_id: form.engineer_user_id ? Number(form.engineer_user_id) : null,
        technician_id: form.technician_id ? Number(form.technician_id) : null,
        mr_no: form.mr_no || null,
      });
      setForm({ ticket_id: "", material_name: "", uom: "", qty: "", in_stock: false,
        engineer_user_id: "", technician_id: "", mr_no: "" });
      load();
    } catch (err: any) {
      setBanner(err?.response?.data?.detail ?? "Could not raise claim.");
    }
  };

  const openAction = (c: MaterialClaim) => {
    const a = nextAction(c);
    if (!a) return;
    setActionClaim(c);
    setAction(a);
    // prefill dates with today
    const init: Record<string, string> = {};
    a.fields.forEach((f) => { if (FIELD_META[f].type === "date") init[f] = today(); });
    setActionValues(init);
  };

  const submitAction = async (e: FormEvent) => {
    e.preventDefault();
    if (!actionClaim || !action) return;
    // require all fields filled
    for (const f of action.fields) {
      if (!actionValues[f]) { setBanner(`${FIELD_META[f].label} is required.`); return; }
    }
    setBanner(null);
    try {
      await updateClaim(actionClaim.id, actionValues);
      setActionClaim(null);
      setAction(null);
      load();
    } catch (err: any) {
      setBanner(err?.response?.data?.detail ?? "Could not update claim.");
    }
  };

  return (
    <div>
      {banner && (
        <div className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {banner}
        </div>
      )}

      {/* Raise a claim */}
      <Card className="mb-5">
        <h3 className="mb-3 font-semibold text-slate-700">Raise material claim (to Blue Star Ltd)</h3>
        <form onSubmit={submitCreate} className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Ticket *">
            <Select value={form.ticket_id} onChange={(e) => setForm({ ...form, ticket_id: e.target.value })}>
              <option value="">Select…</option>
              {tickets.map((t) => <option key={t.id} value={t.id}>{t.ticket_no}</option>)}
            </Select>
          </Field>
          <Field label="Material *">
            <Select
              value={form.material_name}
              onChange={(e) => {
                const m = catalog.find((x) => x.name === e.target.value);
                setForm({ ...form, material_name: e.target.value, uom: m?.uom ?? "" });
              }}
            >
              <option value="">Select…</option>
              {catalog.map((m) => <option key={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <Field label="Qty *">
            <Input type="number" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
          </Field>
          <Field label="Responsible engineer">
            <Select value={form.engineer_user_id} onChange={(e) => setForm({ ...form, engineer_user_id: e.target.value })}>
              <option value="">Select…</option>
              {engineers.map((u) => <option key={u.id} value={u.id}>{u.full_name ?? u.username}</option>)}
            </Select>
          </Field>
          <Field label="Responsible technician">
            <Select value={form.technician_id} onChange={(e) => setForm({ ...form, technician_id: e.target.value })}>
              <option value="">Select…</option>
              {team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </Field>
          <Field label="MR No (optional)">
            <Input value={form.mr_no} onChange={(e) => setForm({ ...form, mr_no: e.target.value })} />
          </Field>
          <label className="col-span-2 flex items-center gap-2 text-sm font-medium text-slate-700 md:col-span-3">
            <input
              type="checkbox"
              checked={form.in_stock}
              onChange={(e) => setForm({ ...form, in_stock: e.target.checked })}
            />
            Material is in stock (use now, then claim replacement) — unchecked = claim first, then use
          </label>
          <div className="col-span-2 md:col-span-3">
            <Button type="submit">Raise claim</Button>
          </div>
        </form>
      </Card>

      {/* Filters + export */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-40"><Input placeholder="Ticket no…" value={fTicket}
          onChange={(e) => setFTicket(e.target.value)} /></div>
        <div className="w-48">
          <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
            <option value="">All statuses</option>
            {CLAIM_STATUSES.map((s) => <option key={s}>{s}</option>)}
          </Select>
        </div>
        <div className="w-40"><Input type="date" value={fStart} title="MR date from"
          onChange={(e) => setFStart(e.target.value)} /></div>
        <div className="w-40"><Input type="date" value={fEnd} title="MR date to"
          onChange={(e) => setFEnd(e.target.value)} /></div>
        <div className="ml-auto">
          <Button variant="ghost" onClick={doExport} disabled={exporting}>
            {exporting ? "Exporting…" : "⬇ Export to Excel"}
          </Button>
        </div>
      </div>

      {/* Claims list */}
      <Table head={["Claim No", "Ticket", "Material", "Qty", "Path", "Status", "Engineer / Tech", "Action"]}>
        {filteredClaims.map((c) => {
          const a = nextAction(c);
          const isHl = highlight === c.claim_no;
          return (
            <tr
              key={c.id}
              ref={isHl ? highlightRef : undefined}
              className={isHl ? "bg-amber-50 ring-2 ring-amber-300" : undefined}
            >
              <td className="px-4 py-2 font-mono font-medium">{c.claim_no}</td>
              <td className="px-4 py-2 font-mono">{ticketNo(c.ticket_id)}</td>
              <td className="px-4 py-2">{c.material_name}</td>
              <td className="px-4 py-2">{c.qty} {c.uom}</td>
              <td className="px-4 py-2 text-xs text-slate-500">{c.in_stock ? "In stock" : "Procure"}</td>
              <td className="px-4 py-2"><ClaimBadge status={c.status} /></td>
              <td className="px-4 py-2 text-xs text-slate-500">
                {engName(c.engineer_user_id)} / {techName(c.technician_id)}
              </td>
              <td className="px-4 py-2">
                {a ? (
                  <button onClick={() => openAction(c)} className="text-xs font-medium text-slate-700 hover:underline">
                    {a.label} →
                  </button>
                ) : (
                  <span className="text-xs text-emerald-600">Closed</span>
                )}
              </td>
            </tr>
          );
        })}
        {filteredClaims.length === 0 && (
          <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-400">No claims match</td></tr>
        )}
      </Table>

      {/* Defective stock at office */}
      <div className="mb-3 mt-8 flex items-center gap-3">
        <h3 className="text-lg font-semibold text-slate-800">Defective stock (at office)</h3>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
          {defective.length}
        </span>
      </div>
      <Table head={["Claim No", "Ticket", "Material", "Qty", "Returned", "Engineer / Tech"]}>
        {defective.map((d) => (
          <tr key={d.claim_id}>
            <td className="px-4 py-2 font-mono">{d.claim_no}</td>
            <td className="px-4 py-2 font-mono">{ticketNo(d.ticket_id)}</td>
            <td className="px-4 py-2">{d.material_name}</td>
            <td className="px-4 py-2">{d.qty} {d.uom}</td>
            <td className="px-4 py-2">{d.defective_returned_date}</td>
            <td className="px-4 py-2 text-xs text-slate-500">
              {engName(d.engineer_user_id)} / {techName(d.technician_id)}
            </td>
          </tr>
        ))}
        {defective.length === 0 && (
          <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-400">No defective units held</td></tr>
        )}
      </Table>

      {/* Action modal */}
      <Modal
        open={!!actionClaim && !!action}
        title={action ? `${action.label} — ${actionClaim?.claim_no}` : ""}
        onClose={() => { setActionClaim(null); setAction(null); }}
      >
        {action && (
          <form onSubmit={submitAction} className="space-y-3">
            {action.fields.map((f) => (
              <Field key={f} label={`${FIELD_META[f].label} *`}>
                <Input
                  type={FIELD_META[f].type}
                  value={actionValues[f] ?? ""}
                  onChange={(e) => setActionValues({ ...actionValues, [f]: e.target.value })}
                />
              </Field>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="ghost" onClick={() => { setActionClaim(null); setAction(null); }}>
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
