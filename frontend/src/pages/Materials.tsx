import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { Button, Card, Field, Input, PageHeader, Table } from "../components/ui/primitives";
import ClaimsTab from "../components/features/materials/ClaimsTab";
import InwardTab from "../components/features/materials/InwardTab";
import IssuesTab from "../components/features/materials/IssuesTab";
import StockTab from "../components/features/materials/StockTab";
import {
  createMaterial,
  createMaterialsTrackerEntry,
  listMaterials,
  listMaterialsTracker,
  listTickets,
} from "../api/services";
import type { MaterialItem, MaterialsTrackerEntry, Ticket } from "../types";

const TABS = ["Stock", "Claims", "Inward", "Issues", "Catalog", "Tracker"] as const;
type Tab = (typeof TABS)[number];

export default function Materials() {
  const [searchParams] = useSearchParams();
  // Honor a deep-link like /materials?tab=Claims (from a ticket's claim link).
  const initialTab = TABS.find((t) => t === searchParams.get("tab")) ?? "Stock";
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <div>
      <PageHeader title="Materials" />
      <div className="mb-5 flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t
                ? "border-slate-800 text-slate-800"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Stock" && <StockTab />}
      {tab === "Claims" && <ClaimsTab />}
      {tab === "Inward" && <InwardTab />}
      {tab === "Issues" && <IssuesTab />}
      {tab === "Catalog" && <CatalogTab />}
      {tab === "Tracker" && <TrackerTab />}
    </div>
  );
}

// ---- Catalog (Materials Database master) ----
function CatalogTab() {
  const [catalog, setCatalog] = useState<MaterialItem[]>([]);
  const [item, setItem] = useState({ name: "", uom: "Nos" });

  const load = () => listMaterials().then(setCatalog);
  useEffect(() => { load(); }, []);

  const addItem = async (e: FormEvent) => {
    e.preventDefault();
    if (!item.name.trim()) return;
    await createMaterial(item);
    setItem({ name: "", uom: "Nos" });
    load();
  };

  return (
    <div className="max-w-2xl">
      <Card className="mb-3">
        <form onSubmit={addItem} className="flex items-end gap-3">
          <div className="flex-1">
            <Field label="Material">
              <Input value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} />
            </Field>
          </div>
          <div className="w-24">
            <Field label="UOM">
              <Input value={item.uom} onChange={(e) => setItem({ ...item, uom: e.target.value })} />
            </Field>
          </div>
          <Button type="submit">Add</Button>
        </form>
      </Card>
      <Table head={["Material", "UOM"]}>
        {catalog.map((m) => (
          <tr key={m.id}>
            <td className="px-4 py-2">{m.name}</td>
            <td className="px-4 py-2">{m.uom}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

// ---- Per-ticket Materials Tracker ----
function TrackerTab() {
  const [entries, setEntries] = useState<MaterialsTrackerEntry[]>([]);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [catalog, setCatalog] = useState<MaterialItem[]>([]);
  const [entry, setEntry] = useState({
    ticket_id: "", material_name: "", uom: "", requested_qty: "", received_qty: "",
  });

  const load = () => listMaterialsTracker().then(setEntries);
  useEffect(() => { load(); listTickets().then(setTickets); listMaterials().then(setCatalog); }, []);

  const ticketNo = (id: number) => tickets.find((t) => t.id === id)?.ticket_no ?? id;

  const addEntry = async (e: FormEvent) => {
    e.preventDefault();
    if (!entry.ticket_id || !entry.material_name) return;
    await createMaterialsTrackerEntry({
      ticket_id: Number(entry.ticket_id),
      material_name: entry.material_name,
      uom: entry.uom || "Nos",
      requested_qty: entry.requested_qty ? Number(entry.requested_qty) : undefined,
      received_qty: entry.received_qty ? Number(entry.received_qty) : undefined,
    });
    setEntry({ ticket_id: "", material_name: "", uom: "", requested_qty: "", received_qty: "" });
    load();
  };

  return (
    <div>
      <Card className="mb-3 max-w-3xl">
        <form onSubmit={addEntry} className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Field label="Ticket">
            <select className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={entry.ticket_id}
              onChange={(e) => setEntry({ ...entry, ticket_id: e.target.value })}>
              <option value="">Select…</option>
              {tickets.map((t) => <option key={t.id} value={t.id}>{t.ticket_no}</option>)}
            </select>
          </Field>
          <Field label="Material">
            <select className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={entry.material_name}
              onChange={(e) => {
                const m = catalog.find((x) => x.name === e.target.value);
                setEntry({ ...entry, material_name: e.target.value, uom: m?.uom ?? "" });
              }}>
              <option value="">Select…</option>
              {catalog.map((m) => <option key={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="Requested qty">
            <Input type="number" value={entry.requested_qty}
              onChange={(e) => setEntry({ ...entry, requested_qty: e.target.value })} />
          </Field>
          <Field label="Received qty">
            <Input type="number" value={entry.received_qty}
              onChange={(e) => setEntry({ ...entry, received_qty: e.target.value })} />
          </Field>
          <div className="md:col-span-4">
            <Button type="submit">Add entry</Button>
          </div>
        </form>
      </Card>
      <Table head={["Ticket", "Material", "UOM", "Req", "Recd"]}>
        {entries.map((m) => (
          <tr key={m.id}>
            <td className="px-4 py-2 font-mono">{ticketNo(m.ticket_id)}</td>
            <td className="px-4 py-2">{m.material_name}</td>
            <td className="px-4 py-2">{m.uom}</td>
            <td className="px-4 py-2">{m.requested_qty ?? "—"}</td>
            <td className="px-4 py-2">{m.received_qty ?? "—"}</td>
          </tr>
        ))}
        {entries.length === 0 && (
          <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No entries</td></tr>
        )}
      </Table>
    </div>
  );
}
