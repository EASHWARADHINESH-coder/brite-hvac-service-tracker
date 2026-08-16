import { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";

import CommandPalette from "./CommandPalette";
import TopBar from "./TopBar";
import Logo from "../ui/Logo";

import { useAuth } from "../../context/AuthContext";
import { useTheme } from "../../context/ThemeContext";
import type { ThemePref } from "../../context/ThemeContext";

export default function Layout() {
  const { isPrivileged, isAdmin, hasOrgScope } = useAuth();
  // On phones the sidebar is an off-canvas drawer; this tracks whether it's slid in.
  const [navOpen, setNavOpen] = useState(false);
  const { pref, setPref } = useTheme();

  const nav = [
    { to: "/", label: "Dashboard", end: true, show: true },
    { to: "/tickets", label: "Tickets", show: true },
    { to: "/wip", label: "WIP Report", show: hasOrgScope },
    { to: "/tasks", label: "Tasks", show: true },
    { to: "/payments", label: "Payments", show: isPrivileged },
    { to: "/assistant", label: "Assistant", show: true },
    { to: "/materials", label: "Materials", show: isPrivileged },
    { to: "/customers-pms", label: "Customers & PMS", show: isPrivileged },
    { to: "/team", label: "Team", show: isAdmin },
    { to: "/users", label: "Users", show: isAdmin },
  ].filter((n) => n.show);

  // The sidebar's contents are identical on desktop and in the mobile drawer.
  const sidebar = (
    <>
      <div className="border-b border-slate-200 px-5 py-4">
        <Logo />
      </div>
      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto p-3">
        {nav.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            onClick={() => setNavOpen(false)}
            className={({ isActive }) =>
              `rounded-md px-3 py-2 text-sm font-medium ${
                isActive ? "bg-slate-800 text-white" : "text-slate-600 hover:bg-slate-100"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-slate-200 p-3 text-sm">
        <button
          onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}
          className="mb-3 flex w-full items-center gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-50"
        >
          <span>⌕</span> Search
          <kbd className="ml-auto rounded border border-slate-300 px-1 text-[10px]">Ctrl K</kbd>
        </button>
        {/* Theme: explicit light / dark, or follow the operating system. */}
        <div className="mb-3 flex gap-1 rounded-md border border-slate-200 p-0.5">
          {(["light", "dark", "system"] as ThemePref[]).map((p) => (
            <button
              key={p}
              onClick={() => setPref(p)}
              aria-pressed={pref === p}
              title={`${p[0].toUpperCase()}${p.slice(1)} theme`}
              className={`flex-1 rounded px-1.5 py-1 text-[11px] font-medium capitalize transition ${
                pref === p ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {p === "light" ? "☀" : p === "dark" ? "☾" : "Auto"}
            </button>
          ))}
        </div>
      </div>
    </>
  );

  return (
    // h-screen (not min-h-screen) so <main> is the element that actually scrolls: that makes
    // it the scrollport sticky table headers anchor to, and keeps the sidebar fixed.
    <div className="flex h-screen bg-slate-50 text-slate-800">
      {/* Desktop sidebar — always present from lg up. */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-slate-200 bg-white lg:flex">
        {sidebar}
      </aside>

      {/* Mobile drawer backdrop — tap to close. */}
      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}
      {/* Drawer only mounts when open — avoids a stuck-transition class toggle and keeps it
          reliably off-screen when closed. */}
      {navOpen && (
        <aside className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-slate-200 bg-white lg:hidden">
          {sidebar}
        </aside>
      )}

      <CommandPalette />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenNav={() => setNavOpen(true)} />

        <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
