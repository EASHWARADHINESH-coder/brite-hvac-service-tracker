import { NavLink, Outlet } from "react-router-dom";

import { useAuth } from "../../context/AuthContext";

export default function Layout() {
  const { user, logout, isPrivileged, isAdmin } = useAuth();

  const nav = [
    { to: "/", label: "Dashboard", end: true, show: true },
    { to: "/tickets", label: "Tickets", show: true },
    { to: "/tickets/new", label: "Create Ticket", show: isPrivileged },
    { to: "/pms", label: "PMS", show: true },
    { to: "/tasks", label: "Tasks", show: true },
    { to: "/payments", label: "Payments", show: isPrivileged },
    { to: "/queries", label: "Queries", show: true },
    { to: "/assistant", label: "Assistant", show: true },
    { to: "/materials", label: "Materials", show: true },
    { to: "/customers", label: "Customers", show: isAdmin },
    { to: "/team", label: "Team", show: isAdmin },
    { to: "/users", label: "Users", show: isAdmin },
  ].filter((n) => n.show);

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800">
      <aside className="flex w-56 shrink-0 flex-col border-r border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-5 py-4">
          <div className="text-lg font-bold">Service Tracker</div>
          <div className="text-xs text-slate-400">HVAC workflow CRM</div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 p-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
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
          <div className="font-medium text-slate-700">{user?.full_name || user?.username}</div>
          <div className="mb-2 text-xs text-slate-400">{user?.role}</div>
          <button onClick={logout} className="text-xs text-rose-600 hover:underline">
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
