import { useSearchParams } from "react-router-dom";

import { PageHeader } from "../components/ui/primitives";
import { useAuth } from "../context/AuthContext";
import Customers from "./Customers";
import PMSPage from "./PMS";

type Tab = "Customers" | "PMS";

/**
 * Customers and PMS under one nav item.
 *
 * Permissions are preserved exactly as they were before the merge (locked decision C1c):
 * the Customers tab is Admin-only, the PMS tab is Admin + Service Engineer. An Engineer
 * therefore sees a PMS-only page and never gains customer access.
 */
export default function CustomersPms() {
  const { isAdmin } = useAuth();
  const [params, setParams] = useSearchParams();

  const tabs: Tab[] = isAdmin ? ["Customers", "PMS"] : ["PMS"];
  const requested = params.get("tab") as Tab | null;
  const tab: Tab = requested && tabs.includes(requested) ? requested : tabs[0];

  return (
    <div>
      <PageHeader title="Customers & PMS" />

      {/* A single available tab needs no tab bar. */}
      {tabs.length > 1 && (
        <div className="mb-5 flex gap-1 border-b border-slate-200">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => {
                const next = new URLSearchParams(params);
                next.set("tab", t);
                setParams(next, { replace: true });
              }}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition ${
                tab === t
                  ? "border-slate-800 text-slate-800"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {tab === "Customers" ? <Customers embedded /> : <PMSPage embedded />}
    </div>
  );
}
