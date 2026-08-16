import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";

import Layout from "./components/layout/Layout";
import { ToastProvider } from "./components/ui/Toast";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ThemeProvider } from "./context/ThemeContext";
import Assistant from "./pages/Assistant";
import CustomersPms from "./pages/CustomersPms";
import CustomerDetail from "./pages/CustomerDetail";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Materials from "./pages/Materials";
import MobileTicket from "./pages/MobileTicket";
import Payments from "./pages/Payments";
import Wip from "./pages/Wip";
import Tasks from "./pages/Tasks";
import Team from "./pages/Team";
import TeamMemberDetail from "./pages/TeamMemberDetail";
import TicketDetail from "./pages/TicketDetail";
import TicketPrint from "./pages/TicketPrint";
import Tickets from "./pages/Tickets";
import Users from "./pages/Users";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

// Gate by capability; redirect unauthorized users to the dashboard.
function RequireRole({ allow, children }: { allow: boolean; children: ReactNode }) {
  return allow ? <>{children}</> : <Navigate to="/" replace />;
}

function AppRoutes() {
  const { isPrivileged, isAdmin, hasOrgScope } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      {/* Phone-first per-ticket view (no sidebar), reached by link/QR. Auth-gated. */}
      <Route
        path="/m/ticket/:id"
        element={
          <RequireAuth>
            <MobileTicket />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="tickets/new" element={<RequireRole allow={isPrivileged}><Tickets /></RequireRole>} />
        <Route path="tickets/:id" element={<TicketDetail />} />
        <Route path="tickets/:id/print" element={<TicketPrint />} />
        <Route path="customers-pms" element={<RequireRole allow={isPrivileged}><CustomersPms /></RequireRole>} />
        {/* Old paths keep working for bookmarks. */}
        <Route path="pms" element={<Navigate to="/customers-pms?tab=PMS" replace />} />
        <Route path="wip" element={<RequireRole allow={hasOrgScope}><Wip /></RequireRole>} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="payments" element={<RequireRole allow={isPrivileged}><Payments /></RequireRole>} />
        <Route path="assistant" element={<Assistant />} />
        <Route path="materials" element={<RequireRole allow={isPrivileged}><Materials /></RequireRole>} />
        <Route path="customers" element={<Navigate to="/customers-pms?tab=Customers" replace />} />
        <Route path="customers/:id" element={<RequireRole allow={isAdmin}><CustomerDetail /></RequireRole>} />
        <Route path="team" element={<RequireRole allow={isAdmin}><Team /></RequireRole>} />
        <Route path="team/:id" element={<RequireRole allow={isAdmin}><TeamMemberDetail /></RequireRole>} />
        <Route path="users" element={<RequireRole allow={isAdmin}><Users /></RequireRole>} />
        {/* Unknown path (e.g. an old /queries bookmark) falls back to the dashboard. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
