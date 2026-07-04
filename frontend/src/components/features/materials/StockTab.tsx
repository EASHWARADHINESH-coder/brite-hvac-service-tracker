import { useEffect, useState } from "react";

import { Button, Table } from "../../ui/primitives";
import { exportStock, getStock } from "../../../api/services";
import type { StockRow } from "../../../types";

export default function StockTab() {
  const [rows, setRows] = useState<StockRow[]>([]);
  const [exporting, setExporting] = useState(false);
  useEffect(() => { getStock().then(setRows); }, []);

  const doExport = async () => {
    setExporting(true);
    try { await exportStock(); } finally { setExporting(false); }
  };

  return (
    <div>
    <div className="mb-3 flex justify-end">
      <Button variant="ghost" onClick={doExport} disabled={exporting}>
        {exporting ? "Exporting…" : "⬇ Export to Excel"}
      </Button>
    </div>
    <Table head={["Material", "UOM", "Received", "Consumed", "On claim", "Available", "Allocated (pending)"]}>
      {rows.map((s) => (
        <tr key={s.material_name}>
          <td className="px-4 py-2 font-medium">{s.material_name}</td>
          <td className="px-4 py-2">{s.uom}</td>
          <td className="px-4 py-2">{s.received}</td>
          <td className="px-4 py-2">{s.consumed}</td>
          <td className="px-4 py-2 text-amber-600">{s.on_claim || "—"}</td>
          <td className={`px-4 py-2 font-semibold ${s.available <= 0 ? "text-rose-600" : "text-emerald-600"}`}>
            {s.available}
          </td>
          <td className="px-4 py-2 text-slate-500">{s.allocated_pending || "—"}</td>
        </tr>
      ))}
      {rows.length === 0 && (
        <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-400">No stock yet</td></tr>
      )}
    </Table>
    </div>
  );
}
