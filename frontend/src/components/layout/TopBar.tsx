import { useEffect, useRef, useState } from "react";

import ChangePasswordModal from "./ChangePasswordModal";
import NotificationBell from "./NotificationBell";
import { useAuth } from "../../context/AuthContext";

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";

/**
 * Fixed top bar: hamburger (mobile) on the left; notification bell + user menu pinned top-right.
 * The user menu shows an initials avatar, name and role, and opens Change password / Sign out.
 */
export default function TopBar({ onOpenNav }: { onOpenNav: () => void }) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const canChangeOwnPassword = user?.role === "Managing Director";
  const name = user?.full_name || user?.username || "User";

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
      {/* Mobile hamburger */}
      <button
        onClick={onOpenNav}
        aria-label="Open menu"
        className="rounded-md p-1 text-slate-600 hover:bg-slate-100 lg:hidden"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
        </svg>
      </button>

      <div className="ml-auto flex items-center gap-1.5">
        <NotificationBell />

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-2 rounded-full py-1 pl-1 pr-2 hover:bg-slate-100"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-600 text-xs font-bold text-white">
              {initials(name)}
            </span>
            <span className="hidden text-left sm:block">
              <span className="block text-sm font-medium leading-tight text-slate-800">{name}</span>
              <span className="block text-[11px] leading-tight text-slate-400">{user?.role}</span>
            </span>
            <span className="text-slate-400">▾</span>
          </button>

          {menuOpen && (
            <div className="absolute right-0 z-50 mt-2 w-52 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              <div className="border-b border-slate-100 px-4 py-2 sm:hidden">
                <div className="text-sm font-medium text-slate-800">{name}</div>
                <div className="text-xs text-slate-400">{user?.role}</div>
              </div>
              {canChangeOwnPassword && (
                <button
                  onClick={() => { setPwOpen(true); setMenuOpen(false); }}
                  className="block w-full px-4 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
                >
                  Change password
                </button>
              )}
              <button
                onClick={logout}
                className="block w-full px-4 py-2 text-left text-sm text-rose-600 hover:bg-slate-50"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>

      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </header>
  );
}
