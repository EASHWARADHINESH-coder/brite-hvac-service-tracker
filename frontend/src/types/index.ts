// Shared TS types — kept in sync with backend enums/schemas.

export type WorkType = "Breakdown" | "Service" | "Repaired Service" | "PMS";
export type MachineType =
  | "VRF" | "Ductable" | "Package" | "Chiller" | "Split" | "Cassette" | "AHU";
export type TicketStatus = "Open" | "In Progress" | "Closed" | "Reopened";
export type TeamType = "Technician" | "Helper" | "Contractor";
export type ComplaintType = "Major Breakdown" | "Minor Breakdown" | "Commissioning";
export type LifecycleStage =
  | "Logged" | "Assigned" | "Work Started" | "Material Pending"
  | "Testing & Commissioning" | "Closed" | "Reopened"
  // Deprecated stages — kept only so historical updates still render.
  | "Diagnosed" | "Parts Requested" | "Repair In Progress";

export const WORK_TYPES: WorkType[] = ["Breakdown", "Service", "Repaired Service", "PMS"];
export const MACHINE_TYPES: MachineType[] = [
  "VRF", "Ductable", "Package", "Chiller", "Split", "Cassette", "AHU",
];
// Current flow (deprecated stages intentionally excluded from selection).
export const LIFECYCLE_STAGES: LifecycleStage[] = [
  "Logged", "Assigned", "Work Started", "Material Pending",
  "Testing & Commissioning", "Closed", "Reopened",
];
export const TEAM_TYPES: TeamType[] = ["Technician", "Helper", "Contractor"];

export interface Customer {
  id: number;
  name: string;
  address?: string | null;
  city?: string | null;
  pincode?: string | null;
  contact_person?: string | null;
  contact_number?: string | null;      // Primary Mobile no
  secondary_mobile?: string | null;
  mail_id?: string | null;
  is_amc?: boolean;
  warranty_start_date?: string | null;
  warranty_end_date?: string | null;
  contract_status?: "WTY" | "AMC" | "NIC";
}

export interface TeamMember {
  id: number;
  name: string;
  team_type: TeamType;
  years_experience?: number | null;
  mobile?: string | null;
  email?: string | null;
  skills?: string | null;
}

export interface Skill { id: number; name: string; }
export interface Complaint { id: number; name: string; complaint_type: ComplaintType; }
export interface MaterialItem { id: number; name: string; uom: string; }

export interface TeamMemberBrief { id: number; name: string; }

export interface TicketUpdate {
  id: number;
  ticket_id: number;
  stage: LifecycleStage;
  action_date?: string | null;
  job_lead?: string | null;
  complaints?: string | null;
  materials?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  status: TicketStatus;
  remarks?: string | null;
  reopen: boolean;
  reopen_reason?: string | null;
  team: TeamMemberBrief[];
}

export interface Ticket {
  id: number;
  ticket_no: string;
  customer_id: number;
  customer_name?: string | null;
  complaint_date: string;
  work_type: WorkType;
  machine_type?: MachineType | null;
  skill?: string | null;
  status: TicketStatus;
  reopen: boolean;
  // 72h assignment SLA (computed by backend)
  is_assigned?: boolean;
  assign_by?: string | null;
  assignment_overdue?: boolean;
  // Repaired Service payment (null for other work types)
  total_amount?: number | null;
  paid_amount?: number | null;
  balance?: number | null;
}

export interface Payment {
  id: number;
  ticket_id: number;
  amount: number;
  paid_date: string;
  is_advance: boolean;
  remarks?: string | null;
}

export interface PaymentSummary {
  ticket_id: number;
  ticket_no: string;
  customer_name?: string | null;
  total_amount?: number | null;
  paid_amount: number;
  balance: number;
  fully_paid: boolean;
  ticket_status: string;
  payments: Payment[];
}

export interface TicketReport {
  id: number;
  ticket_id: number;
  original_name: string;
  size: number;
  uploaded_by_name?: string | null;
  uploaded_at: string;
}

export type QueryStatus = "Open" | "Closed";
export interface Query {
  id: number;
  raised_by_user_id: number;
  raised_by_name?: string | null;
  subject: string;
  message: string;
  ticket_id?: number | null;
  ticket_no?: string | null;
  status: QueryStatus;
  reply?: string | null;
  resolved_by_name?: string | null;
  created_at: string;
  resolved_at?: string | null;
}

export interface PaymentFollowUpRow {
  ticket_id: number;
  ticket_no: string;
  customer_name?: string | null;
  complaint_date: string;
  total_amount: number;
  paid_amount: number;
  balance: number;
  ticket_status: string;
}

export interface TicketDetail extends Ticket {
  primary_complaint?: string | null;
  requires_tc?: boolean;
  updates: TicketUpdate[];
}

export interface PMS {
  id: number;
  customer_id: number;
  wo_number: string;
  wo_start_date?: string | null;
  wo_end_date?: string | null;
  schedule?: string | null;
  complaint?: string | null;
  schedule_1?: string | null;
  schedule_2?: string | null;
  schedule_3?: string | null;
  schedule_4?: string | null;
  schedule_5?: string | null;
  schedule_6?: string | null;
}

export interface PMSVisitRow {
  pms_id: number;
  wo_number: string;
  customer_name?: string | null;
  visit_no: number;
  visit_date: string;
  status: "Generated" | "Due" | "Upcoming";
  ticket_id?: number | null;
  ticket_no?: string | null;
}

export interface MaterialsTrackerEntry {
  id: number;
  ticket_id: number;
  material_name: string;
  uom: string;
  requested_qty?: number | null;
  requested_date?: string | null;
  received_qty?: number | null;
  received_date?: string | null;
  purchasing_group?: string | null;
  responsible_person?: string | null;
  work_type?: WorkType | null;
  machine_type?: MachineType | null;
}

export type UserRole = "Service Admin" | "Service Engineer" | "Technician" | "Helper";
export const USER_ROLES: UserRole[] = [
  "Service Admin", "Service Engineer", "Technician", "Helper",
];

// ---- Tasks ----
export type TaskStatus = "Open" | "In Progress" | "Done";
export type TaskPriority = "Low" | "Normal" | "High";
export const TASK_STATUSES: TaskStatus[] = ["Open", "In Progress", "Done"];
export const TASK_PRIORITIES: TaskPriority[] = ["Low", "Normal", "High"];

export interface Task {
  id: number;
  title: string;
  description?: string | null;
  assignee_user_id: number;
  assigned_by_user_id?: number | null;
  ticket_id?: number | null;
  priority: TaskPriority;
  due_date?: string | null;
  status: TaskStatus;
  created_at: string;
  assignee_name?: string | null;
  assigned_by_name?: string | null;
  ticket_no?: string | null;
  overdue?: boolean;
}

export interface AuthToken {
  access_token: string;
  token_type: string;
  role: UserRole;
  full_name?: string | null;
  username: string;
}

export interface AppUser {
  id: number;
  username: string;
  email?: string | null;
  full_name?: string | null;
  role: UserRole;
  is_active: boolean;
  team_member_id?: number | null;
}

export type InwardSource = "BSL Sales Order" | "BSL Material Request" | "Supplier";
export type IssueOutcome = "Used" | "Not Used";
export type IssueStatus = "Allocated" | "Closed";

export const INWARD_SOURCES: InwardSource[] = [
  "BSL Sales Order", "BSL Material Request", "Supplier",
];

export interface MaterialInward {
  id: number;
  inward_no: string;
  source_type: InwardSource;
  doc_no?: string | null;
  supplier?: string | null;
  material_name: string;
  uom: string;
  qty: number;
  received_date: string;
}

export interface MaterialIssue {
  id: number;
  issue_no: string;
  inward_id?: number | null;
  ticket_id: number;
  customer_site?: string | null;
  material_name: string;
  uom: string;
  qty: number;
  issue_date: string;
  delivery_note_no?: string | null;
  outcome?: IssueOutcome | null;
  status: IssueStatus;
}

export interface StockRow {
  material_name: string;
  uom: string;
  received: number;
  consumed: number;
  available: number;
  allocated_pending: number;
  on_claim: number;
}

export type ClaimStatus =
  | "MR Raised"
  | "Material Received"
  | "Awaiting Replenishment"
  | "Replaced"
  | "Defective in Office"
  | "Dispatched to BSL";

export interface MaterialClaim {
  id: number;
  claim_no: string;
  ticket_id: number;
  customer_id?: number | null;
  material_name: string;
  uom: string;
  qty: number;
  in_stock: boolean;
  engineer_user_id?: number | null;
  technician_id?: number | null;
  mr_no?: string | null;
  mr_date: string;
  delivery_challan_no?: string | null;
  delivery_challan_date?: string | null;
  used_date?: string | null;
  defective_returned_date?: string | null;
  pod_no?: string | null;
  pod_date?: string | null;
  status: ClaimStatus;
  remarks?: string | null;
}

export interface DefectiveStockRow {
  claim_id: number;
  claim_no: string;
  ticket_id: number;
  material_name: string;
  uom: string;
  qty: number;
  defective_returned_date?: string | null;
  engineer_user_id?: number | null;
  technician_id?: number | null;
}

export interface DashboardOverview {
  scope: "org" | "personal";
  // org
  tickets?: Record<string, number>;
  breakdown_by_status?: Record<string, number>;
  by_work_type?: Record<string, number>;
  attention?: {
    assignment_overdue: number;
    payment_pending_count: number;
    payment_pending_total: number;
    open_queries: number;
    open_claims: number;
    pms_due: number;
  };
  contracts?: Record<string, number>;
  // personal
  my_tickets?: Record<string, number>;
  my_tickets_total?: number;
  my_open_tasks?: number;
  my_open_queries?: number;
}

export interface DashboardSummary {
  total_tickets: number;
  open: number;
  in_progress: number;
  closed: number;
  reopened: number;
  by_status: Record<string, number>;
  by_work_type: Record<string, number>;
  customers: number;
}

// ---- AI layer (Phase 5) ----
export interface AIStatus {
  enabled: boolean;
  llm_available: boolean;
  provider: string;
  model: string;
}

export interface RankedTicket {
  ticket_id: number;
  ticket_no: string;
  customer_name: string | null;
  work_type: string;
  score: number;
  reasons: string[];
  rationale: string | null;
}

export interface DeliveryNoteDraft {
  ticket_id: number;
  ticket_no: string;
  customer_name: string | null;
  customer_site: string | null;
  issue_date: string;
  lines: { material_name: string; uom: string; qty: number }[];
  body: string;
  llm_enhanced: boolean;
}

export interface AssistantReply {
  answer: string;
  source: "deterministic" | "llm";
  used_llm: boolean;
}

export interface AgentProposal {
  type: string;
  args: Record<string, unknown>;
  summary: string;
}

export interface ActionResult {
  action: string;
  ticket_id: number | null;
  ticket_no: string | null;
  message: string;
}

export type AgentStreamMessage =
  | { type: "token"; text: string }
  | { type: "proposal"; proposal: AgentProposal }
  | { type: "done"; used_llm: boolean; provider: string };

// ---- AI status panel (Phase 6) ----
export interface AIHealth {
  enabled: boolean;
  provider: string;
  chat_model: string;
  llm_available: boolean;
  model_chain: string[];
  embeddings_model: string;
  vector_store: boolean;
  indexed_documents: number;
  circuit: { open: boolean; failures: number; cooldown_remaining: number };
}

export interface AIOpMetric {
  operation: string;
  count: number;
  avg_ms: number;
  max_ms: number;
}

export interface AIMetrics {
  total: number;
  errors?: number;
  error_rate: number;
  cache_hits?: number;
  cache_hit_rate: number;
  by_operation: AIOpMetric[];
}

export interface AIJob {
  id: number;
  kind: string;
  status: string;
  detail?: string | null;
}
