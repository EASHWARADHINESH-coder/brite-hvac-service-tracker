import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";

type ToastKind = "success" | "error" | "info";

type Toast = {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
};

type ToastApi = {
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  info: (title: string, detail?: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/** Errors stay until dismissed; success/info clear themselves. */
const AUTO_DISMISS_MS = 5000;

const STYLE: Record<ToastKind, { bar: string; dot: string }> = {
  success: { bar: "border-l-emerald-500", dot: "bg-emerald-500" },
  error: { bar: "border-l-rose-500", dot: "bg-rose-500" },
  info: { bar: "border-l-sky-500", dot: "bg-sky-500" },
};

function ToastRow({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  useEffect(() => {
    if (toast.kind === "error") return; // errors need an explicit dismiss
    const t = setTimeout(onClose, AUTO_DISMISS_MS);
    return () => clearTimeout(t);
  }, [toast.kind, onClose]);

  const style = STYLE[toast.kind];
  return (
    <div
      role={toast.kind === "error" ? "alert" : "status"}
      className={`pointer-events-auto flex w-80 items-start gap-3 rounded-lg border border-slate-200 border-l-4 bg-white p-3 shadow-lg ${style.bar}`}
    >
      <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${style.dot}`} />
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-800">{toast.title}</div>
        {toast.detail && (
          <div className="mt-0.5 break-words text-xs text-slate-500">{toast.detail}</div>
        )}
      </div>
      <button
        onClick={onClose}
        aria-label="Dismiss"
        className="rounded px-1 text-slate-400 hover:text-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
      >
        ✕
      </button>
    </div>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, title: string, detail?: string) => {
    // Date.now can collide within a tick; add a random suffix so keys stay unique.
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, kind, title, detail }]);
  }, []);

  const api: ToastApi = {
    success: (t, d) => push("success", t, d),
    error: (t, d) => push("error", t, d),
    info: (t, d) => push("info", t, d),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col gap-2"
      >
        {toasts.map((t) => (
          <ToastRow key={t.id} toast={t} onClose={() => remove(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
