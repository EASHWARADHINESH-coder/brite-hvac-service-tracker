from enum import Enum


class WorkType(str, Enum):
    BREAKDOWN = "Breakdown"
    SERVICE = "Service"
    REPAIRED_SERVICE = "Repaired Service"
    PMS = "PMS"


# Ticket-number prefix per work type (see business rule #1/#3).
WORK_TYPE_PREFIX = {
    WorkType.BREAKDOWN: "B",
    WorkType.SERVICE: "S",
    WorkType.REPAIRED_SERVICE: "R",
    WorkType.PMS: "P",
}


class MachineType(str, Enum):
    VRF = "VRF"
    DUCTABLE = "Ductable"
    PACKAGE = "Package"
    CHILLER = "Chiller"
    SPLIT = "Split"
    CASSETTE = "Cassette"
    AHU = "AHU"


class TicketStatus(str, Enum):
    OPEN = "Open"
    IN_PROGRESS = "In Progress"
    CLOSED = "Closed"
    REOPENED = "Reopened"
    CANCELLED = "Cancelled"  # terminal; number retained, no reopen (non-MR tickets only)


class LifecycleStage(str, Enum):
    # Active flow: Logged → Assigned → Work Started → (Material Pending) →
    #              (Testing & Commissioning) → Closed → Reopened
    LOGGED = "Logged"
    ASSIGNED = "Assigned"
    WORK_STARTED = "Work Started"
    MATERIAL_PENDING = "Material Pending"
    TESTING_COMMISSIONING = "Testing & Commissioning"
    CLOSED = "Closed"
    REOPENED = "Reopened"

    # Deprecated — retained only so historical ticket_update rows still load.
    # Not offered in the UI flow anymore.
    DIAGNOSED = "Diagnosed"
    PARTS_REQUESTED = "Parts Requested"
    REPAIR_IN_PROGRESS = "Repair In Progress"


# Stages offered in the current UI flow (excludes deprecated stages).
ACTIVE_LIFECYCLE_STAGES = [
    LifecycleStage.LOGGED,
    LifecycleStage.ASSIGNED,
    LifecycleStage.WORK_STARTED,
    LifecycleStage.MATERIAL_PENDING,
    LifecycleStage.TESTING_COMMISSIONING,
    LifecycleStage.CLOSED,
    LifecycleStage.REOPENED,
]

# Complaints that auto-suggest the Testing & Commissioning stage (by Complaint.name).
TC_TRIGGER_COMPLAINTS = {"Gas Leakage", "Compressor failure"}

# Hours allowed to assign a logged ticket before it is flagged overdue.
ASSIGNMENT_SLA_HOURS = 72


class TeamType(str, Enum):
    TECHNICIAN = "Technician"
    HELPER = "Helper"
    CONTRACTOR = "Contractor"


class ComplaintType(str, Enum):
    MAJOR_BREAKDOWN = "Major Breakdown"
    MINOR_BREAKDOWN = "Minor Breakdown"
    COMMISSIONING = "Commissioning"


class UserRole(str, Enum):
    SERVICE_ADMIN = "Service Admin"        # everything: users, master data, deletes
    SERVICE_ENGINEER = "Service Engineer"  # day-to-day ops across all tickets + assign tasks
    MANAGING_DIRECTOR = "Managing Director"  # org-wide read-only oversight; escalation level 2
    TECHNICIAN = "Technician"              # job lead; edits only their own tickets/tasks
    HELPER = "Helper"                      # follows job lead; view only their own tasks


# Roles that can ACT across all tickets. Deliberately excludes Managing Director — several
# endpoints use is_privileged() to gate writes, so adding MD here would grant write access.
PRIVILEGED_ROLES = {UserRole.SERVICE_ADMIN, UserRole.SERVICE_ENGINEER}
# Roles that can SEE every ticket (org-wide read scope). MD observes but never edits.
ORG_SCOPE_ROLES = PRIVILEGED_ROLES | {UserRole.MANAGING_DIRECTOR}
# Task-scoped roles are limited to their own assigned work.

# Escalation (no activity logged for N days on a still-open ticket).
ESCALATION_L1_DAYS = 2  # -> Service Engineer + Service Admin
ESCALATION_L2_DAYS = 5  # -> Managing Director
# Roles scoped to only their own assigned tasks.
TASK_SCOPED_ROLES = {UserRole.TECHNICIAN, UserRole.HELPER}


class TaskStatus(str, Enum):
    OPEN = "Open"
    IN_PROGRESS = "In Progress"
    DONE = "Done"


class TaskPriority(str, Enum):
    LOW = "Low"
    NORMAL = "Normal"
    HIGH = "High"


class QueryStatus(str, Enum):
    OPEN = "Open"
    CLOSED = "Closed"


class InwardSource(str, Enum):
    BSL_SALES_ORDER = "BSL Sales Order"
    BSL_MATERIAL_REQUEST = "BSL Material Request"
    SUPPLIER = "Supplier"


class IssueOutcome(str, Enum):
    USED = "Used"          # consumed on the job (delivery note issued)
    NOT_USED = "Not Used"  # returned to stock


class IssueStatus(str, Enum):
    ALLOCATED = "Allocated"  # reserved to a ticket, not yet delivered/closed
    CLOSED = "Closed"        # delivery note issued (Used) or returned (Not Used)


class ClaimStatus(str, Enum):
    """AMC material-claim lifecycle (Blue Star Ltd warranty replacement).

    Derived from the claim's recorded fields — see services.material_claim.compute_claim_status.
    """

    MR_RAISED = "MR Raised"                       # request raised to BSL for a ticket
    MATERIAL_RECEIVED = "Material Received"        # not-in-stock: BSL delivered (Delivery Challan)
    AWAITING_REPLENISH = "Awaiting Replenishment"  # in-stock: used from stock, BSL not yet replaced
    REPLACED = "Replaced"                          # replacement fitted at site & stock settled
    DEFECTIVE_RETURNED = "Defective in Office"     # faulty unit back at office (defective stock)
    DISPATCHED = "Dispatched to BSL"               # sent to BSL warehouse with POD — claim closed
