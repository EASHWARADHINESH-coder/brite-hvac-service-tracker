import { api, TOKEN_KEY } from "./client";
import type {
  ActionResult,
  AgentProposal,
  AgentStreamMessage,
  AIHealth,
  AIJob,
  AIMetrics,
  AIStatus,
  AppUser,
  AssistantReply,
  AuthToken,
  Complaint,
  DeliveryNoteDraft,
  Customer,
  DashboardOverview,
  DashboardSummary,
  DefectiveStockRow,
  IssueOutcome,
  MaterialClaim,
  MaterialInward,
  MaterialIssue,
  MaterialItem,
  MaterialsTrackerEntry,
  PaymentFollowUpRow,
  PaymentSummary,
  PMS,
  PMSVisitRow,
  Query,
  RankedTicket,
  Skill,
  StockRow,
  Task,
  TeamMember,
  Ticket,
  TicketDetail,
  TicketReport,
  TicketStatus,
  WorkType,
} from "../types";

const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data);

// ---- Auth ----
export const login = (username: string, password: string) =>
  data<AuthToken>(api.post("/auth/login", { username, password }));
export const getMe = () => data<AppUser>(api.get("/auth/me"));

// ---- Users (Service Admin) ----
export const listUsers = () => data<AppUser[]>(api.get("/users"));
export const createUser = (payload: {
  username: string; password: string; role: string;
  full_name?: string; email?: string; team_member_id?: number;
}) => data<AppUser>(api.post("/users", payload));
export const deactivateUser = (id: number) =>
  data<AppUser>(api.post(`/users/${id}/deactivate`, {}));
export const updateUser = (id: number, payload: {
  username?: string; full_name?: string; email?: string; role?: string;
  is_active?: boolean; password?: string;
}) => data<AppUser>(api.put(`/users/${id}`, payload));

// ---- Customers ----
export const listCustomers = (q?: string) =>
  data<Customer[]>(api.get("/customers", { params: { q } }));
export const getCustomer = (id: number) =>
  data<Customer>(api.get(`/customers/${id}`));
export const createCustomer = (payload: Partial<Customer>) =>
  data<Customer>(api.post("/customers", payload));
export const updateCustomer = (id: number, payload: Partial<Customer>) =>
  data<Customer>(api.put(`/customers/${id}`, payload));
export const deleteCustomer = (id: number) => api.delete(`/customers/${id}`);

// ---- Team ----
export const listTeam = () => data<TeamMember[]>(api.get("/team"));
export const getTeamMember = (id: number) =>
  data<TeamMember>(api.get(`/team/${id}`));
export const memberTickets = (id: number) =>
  data<Ticket[]>(api.get(`/team/${id}/tickets`));
export interface TeamMemberCreatePayload extends Partial<TeamMember> {
  grant_access?: boolean;
  username?: string;
  password?: string;
}
export const createTeamMember = (payload: TeamMemberCreatePayload) =>
  data<TeamMember>(api.post("/team", payload));
export const updateTeamMember = (id: number, payload: Partial<TeamMember>) =>
  data<TeamMember>(api.put(`/team/${id}`, payload));
export const deleteTeamMember = (id: number) => api.delete(`/team/${id}`);

// ---- Masters (read) ----
export const listSkills = () => data<Skill[]>(api.get("/skills"));
export const listComplaints = () => data<Complaint[]>(api.get("/complaints"));
export const listMaterials = () => data<MaterialItem[]>(api.get("/materials"));
export const createMaterial = (payload: Partial<MaterialItem>) =>
  data<MaterialItem>(api.post("/materials", payload));

// ---- Tickets ----
export interface TicketFilters {
  status?: TicketStatus;
  work_type?: WorkType;
  customer_id?: number;
  q?: string;
}
export const listTickets = (filters: TicketFilters = {}) =>
  data<Ticket[]>(api.get("/tickets", { params: filters }));
export const getTicket = (id: number) => data<TicketDetail>(api.get(`/tickets/${id}`));
export const createTicket = (payload: {
  customer_id: number;
  complaint_date: string;
  work_type: WorkType;
  machine_type: string;
  primary_complaint?: string;
  skill?: string;
  remarks?: string;
  total_amount?: number;
  advance_amount?: number;
}) => data<TicketDetail>(api.post("/tickets", payload));
export const addTicketUpdate = (
  ticketId: number,
  payload: Record<string, unknown>,
) => data<TicketDetail>(api.post(`/tickets/${ticketId}/updates`, payload));
export const createMaterialPending = (
  ticketId: number,
  payload: {
    material_name: string; uom: string; qty: number; in_stock: boolean;
    mr_no?: string | null; technician_id?: number | null;
    action_date?: string | null; remarks?: string | null;
  },
) => data<TicketDetail>(api.post(`/tickets/${ticketId}/material-pending`, payload));

// ---- Ticket report PDFs ----
export const listTicketReports = (ticketId: number) =>
  data<TicketReport[]>(api.get(`/tickets/${ticketId}/reports`));
export const uploadTicketReport = (ticketId: number, file: File) => {
  const fd = new FormData();
  fd.append("file", file);
  return data<TicketReport>(
    api.post(`/tickets/${ticketId}/reports`, fd, { headers: { "Content-Type": "multipart/form-data" } }),
  );
};
export const deleteTicketReport = (ticketId: number, reportId: number) =>
  api.delete(`/tickets/${ticketId}/reports/${reportId}`);
export const downloadTicketReport = async (ticketId: number, reportId: number, filename: string) => {
  const res = await api.get(`/tickets/${ticketId}/reports/${reportId}/download`, { responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
};

// ---- PMS ----
export const listPMS = (customerId?: number) =>
  data<PMS[]>(api.get("/pms", { params: { customer_id: customerId } }));
export const createPMS = (payload: {
  customer_id: number;
  wo_number: string;
  wo_start_date?: string;
  wo_end_date?: string;
  schedule?: string;
  complaint?: string;
  auto_generate?: boolean;
}) => data<PMS>(api.post("/pms", payload));
export const getPMSSchedule = () => data<PMSVisitRow[]>(api.get("/pms/schedule"));
// Generate tickets for due visits — manual only (no longer runs automatically on page load).
export const autoGeneratePMS = () =>
  data<{ created: number; tickets: string[] }>(api.post("/pms/auto-generate", {}));
// Remove generated PMS tickets that have no work done; visits return to "Due".
export const removeGeneratedPMS = () =>
  data<{ removed: number; tickets: string[]; kept: number }>(api.post("/pms/remove-generated", {}));

// ---- Materials Tracker ----
export const listMaterialsTracker = (ticketId?: number) =>
  data<MaterialsTrackerEntry[]>(
    api.get("/materials-tracker", { params: { ticket_id: ticketId } }),
  );
export const createMaterialsTrackerEntry = (payload: Partial<MaterialsTrackerEntry>) =>
  data<MaterialsTrackerEntry>(api.post("/materials-tracker", payload));

// ---- Materials Ledger ----
export const getStock = () => data<StockRow[]>(api.get("/materials-ledger/stock"));
export const listInward = () => data<MaterialInward[]>(api.get("/materials-ledger/inward"));
export const createInward = (payload: Partial<MaterialInward>) =>
  data<MaterialInward>(api.post("/materials-ledger/inward", payload));
export const listIssues = (ticketId?: number) =>
  data<MaterialIssue[]>(api.get("/materials-ledger/issues", { params: { ticket_id: ticketId } }));
export const allocateIssue = (payload: Partial<MaterialIssue>) =>
  data<MaterialIssue>(api.post("/materials-ledger/issues", payload));
export const deliverIssue = (id: number, outcome: IssueOutcome) =>
  data<MaterialIssue>(api.post(`/materials-ledger/issues/${id}/deliver`, { outcome }));

// ---- Material Claims (AMC / Blue Star Ltd) ----
export const listClaims = (params: { ticket_id?: number; status?: string } = {}) =>
  data<MaterialClaim[]>(api.get("/claims", { params }));
export const getDefectiveStock = () =>
  data<DefectiveStockRow[]>(api.get("/claims/defective"));
export const createClaim = (payload: {
  ticket_id: number;
  material_name: string;
  uom: string;
  qty: number;
  in_stock: boolean;
  engineer_user_id?: number | null;
  technician_id?: number | null;
  mr_no?: string | null;
  mr_date?: string | null;
  remarks?: string | null;
}) => data<MaterialClaim>(api.post("/claims", payload));
export const updateClaim = (id: number, payload: Record<string, unknown>) =>
  data<MaterialClaim>(api.patch(`/claims/${id}`, payload));

// ---- Tasks ----
export interface TaskFilters { status?: string; priority?: string; assignee_user_id?: number }
export const listTasks = (f: TaskFilters = {}) =>
  data<Task[]>(api.get("/tasks", { params: f }));
export const createTask = (payload: {
  title: string; description?: string | null; assignee_user_id: number;
  ticket_id?: number | null; priority?: string; due_date?: string | null;
}) => data<Task>(api.post("/tasks", payload));
export const updateTask = (id: number, payload: Record<string, unknown>) =>
  data<Task>(api.patch(`/tasks/${id}`, payload));
export const deleteTask = (id: number) => api.delete(`/tasks/${id}`);
export interface Assignee { id: number; label: string; role: string }
export const listAssignees = () => data<Assignee[]>(api.get("/tasks/assignees"));

// ---- Payments (Repaired Service follow-up) ----
export const getPaymentFollowUp = () =>
  data<PaymentFollowUpRow[]>(api.get("/payments/follow-up"));
export const getTicketPayments = (ticketId: number) =>
  data<PaymentSummary>(api.get(`/payments/ticket/${ticketId}`));
export const addPayment = (
  ticketId: number,
  payload: { amount: number; paid_date?: string; remarks?: string },
) => data<PaymentSummary>(api.post(`/payments/ticket/${ticketId}`, payload));

// ---- Queries ----
export const listQueries = (status?: string) =>
  data<Query[]>(api.get("/queries", { params: { status } }));
export const createQuery = (payload: { subject: string; message: string; ticket_id?: number | null }) =>
  data<Query>(api.post("/queries", payload));
export const resolveQuery = (id: number, reply: string) =>
  data<Query>(api.post(`/queries/${id}/resolve`, { reply }));

// ---- Dashboard ----
export const getDashboardSummary = () =>
  data<DashboardSummary>(api.get("/dashboard/summary"));
export const getDashboardOverview = () =>
  data<DashboardOverview>(api.get("/dashboard/overview"));

// ---- Excel exports ----
const stamp = () => new Date().toISOString().slice(0, 10);

async function downloadXlsx(
  path: string,
  params: Record<string, unknown>,
  baseName: string,
) {
  // Drop empty params so they don't become "?x=" noise.
  const clean = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== "" && v != null),
  );
  const res = await api.get(path, { params: clean, responseType: "blob" });
  const url = URL.createObjectURL(res.data as Blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseName}_${stamp()}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const exportTickets = (p: {
  start?: string; end?: string; status?: string; work_type?: string;
}) => downloadXlsx("/exports/tickets", p, "tickets");

export const exportPMS = (p: { start?: string; end?: string; customer_id?: number }) =>
  downloadXlsx("/exports/pms", p, "pms");

export const exportCustomers = (p: { q?: string; amc_only?: boolean }) =>
  downloadXlsx("/exports/customers", p, "customers");

export const exportStock = () => downloadXlsx("/exports/materials/stock", {}, "materials_stock");

export const exportClaims = (p: {
  start?: string; end?: string; status?: string; ticket_no?: string;
}) => downloadXlsx("/exports/materials/claims", p, "blue_star_claims");

// ---- AI layer (Phase 5) ----
export const getAIStatus = () => data<AIStatus>(api.get("/ai/status"));
export const rankTickets = (opts: { limit?: number; explain?: boolean } = {}) =>
  data<RankedTicket[]>(api.get("/ai/rank-tickets", { params: opts }));
export const draftDeliveryNote = (ticketId: number, enhance = true) =>
  data<DeliveryNoteDraft>(
    api.post(`/ai/tickets/${ticketId}/delivery-note`, {}, { params: { enhance } }),
  );
export const askAssistant = (question: string) =>
  data<AssistantReply>(api.post("/ai/assistant", { question }));

export const executeAction = (proposal: AgentProposal) =>
  data<ActionResult>(api.post("/ai/actions/execute", { proposal }));

// ---- AI status panel (Phase 6) ----
export const getAIHealth = () => data<AIHealth>(api.get("/ai/health"));
export const getAIMetrics = () => data<AIMetrics>(api.get("/ai/metrics"));
export const reindexAI = () =>
  data<{ job_id: number; status: string }>(api.post("/ai/reindex", {}));
export const getAIJob = (id: number) => data<AIJob>(api.get(`/ai/jobs/${id}`));

// Stream the agent's final-answer tokens over SSE. Uses fetch (not EventSource) so the
// bearer token can be sent as a header. Handlers fire as messages arrive.
export async function streamAssistant(
  question: string,
  handlers: {
    onToken: (text: string) => void;
    onProposal?: (p: AgentProposal) => void;
    onDone?: (usedLlm: boolean) => void;
  },
): Promise<void> {
  const token = localStorage.getItem(TOKEN_KEY);
  const res = await fetch("/api/v1/ai/assistant/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ question }),
  });
  if (!res.ok || !res.body) throw new Error(`Assistant stream failed (${res.status})`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      const json = dataLine.slice(5).trim();
      if (!json) continue;
      let msg: AgentStreamMessage;
      try {
        msg = JSON.parse(json);
      } catch {
        continue;
      }
      if (msg.type === "token") handlers.onToken(msg.text);
      else if (msg.type === "proposal") handlers.onProposal?.(msg.proposal);
      else if (msg.type === "done") handlers.onDone?.(msg.used_llm);
    }
  }
}
