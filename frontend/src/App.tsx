import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import type { ReactNode } from "react";

import Layout from "./components/layout/Layout";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Assistant from "./pages/Assistant";
import Customers from "./pages/Customers";
import CustomerDetail from "./pages/CustomerDetail";
import CreateTicket from "./pages/CreateTicket";
import Dashboard from "./pages/Dashboard";
import Login from "./pages/Login";
import Materials from "./pages/Materials";
import Payments from "./pages/Payments";
import PMSPage from "./pages/PMS";
import Queries from "./pages/Queries";
import Tasks from "./pages/Tasks";
import Team from "./pages/Team";
import TeamMemberDetail from "./pages/TeamMemberDetail";
import TicketDetail from "./pages/TicketDetail";
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
  const { isPrivileged, isAdmin } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="tickets" element={<Tickets />} />
        <Route path="tickets/new" element={<RequireRole allow={isPrivileged}><CreateTicket /></RequireRole>} />
        <Route path="tickets/:id" element={<TicketDetail />} />
        <Route path="pms" element={<PMSPage />} />
        <Route path="tasks" element={<Tasks />} />
        <Route path="payments" element={<RequireRole allow={isPrivileged}><Payments /></RequireRole>} />
        <Route path="queries" element={<Queries />} />
        <Route path="assistant" element={<Assistant />} />
        <Route path="materials" element={<Materials />} />
        <Route path="customers" element={<RequireRole allow={isAdmin}><Customers /></RequireRole>} />
        <Route path="customers/:id" element={<RequireRole allow={isAdmin}><CustomerDetail /></RequireRole>} />
        <Route path="team" element={<RequireRole allow={isAdmin}><Team /></RequireRole>} />
        <Route path="team/:id" element={<RequireRole allow={isAdmin}><TeamMemberDetail /></RequireRole>} />
        <Route path="users" element={<RequireRole allow={isAdmin}><Users /></RequireRole>} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}
