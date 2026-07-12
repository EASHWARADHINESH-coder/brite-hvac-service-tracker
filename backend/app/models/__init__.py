"""SQLModel table definitions for the Service Tracker.

Import order matters for relationship resolution; importing this package registers
every table on SQLModel.metadata.
"""

from app.models.masters import (  # noqa: F401
    Customer,
    TeamMember,
    Skill,
    Complaint,
    MaterialItem,
)
from app.models.tickets import (  # noqa: F401
    Ticket,
    TicketUpdate,
    TicketTeamLink,
)
from app.models.pms import PMS, PMSVisitTicket  # noqa: F401
from app.models.materials import MaterialsTracker  # noqa: F401
from app.models.material_ledger import (  # noqa: F401
    MaterialInward,
    MaterialIssue,
)
from app.models.material_claim import MaterialClaim  # noqa: F401
from app.models.user import User  # noqa: F401
from app.models.task import Task  # noqa: F401
from app.models.payment import Payment  # noqa: F401
from app.models.query import Query  # noqa: F401
from app.models.report import TicketReport  # noqa: F401
from app.models.ai_ops import AIMetric, AIJob, AIDocument  # noqa: F401
