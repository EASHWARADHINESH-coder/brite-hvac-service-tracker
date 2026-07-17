"""Request/response models for the Phase 5 AI endpoints."""

from datetime import date

from pydantic import BaseModel, Field


class AIStatus(BaseModel):
    enabled: bool          # feature flag on
    llm_available: bool    # flag on AND provider usable — LLM path usable
    provider: str          # "groq" | "ollama"
    model: str             # active provider's model id


class RankedTicketOut(BaseModel):
    ticket_id: int
    ticket_no: str
    customer_name: str | None = None
    work_type: str
    score: int
    reasons: list[str] = []
    rationale: str | None = None


class DraftLineOut(BaseModel):
    material_name: str
    uom: str
    qty: float


class DeliveryNoteDraftOut(BaseModel):
    ticket_id: int
    ticket_no: str
    customer_name: str | None = None
    customer_site: str | None = None
    issue_date: date
    lines: list[DraftLineOut] = []
    body: str
    llm_enhanced: bool = False


class AssistantAsk(BaseModel):
    question: str = Field(min_length=1, max_length=500)


class AssistantReplyOut(BaseModel):
    answer: str
    source: str            # "deterministic" | "llm"
    used_llm: bool = False


class ActionExecuteIn(BaseModel):
    """A guarded proposal (as emitted by the streaming agent) the user has confirmed."""

    proposal: dict


class ActionResultOut(BaseModel):
    action: str
    ticket_id: int | None = None
    ticket_no: str | None = None
    message: str


class RetrievedOut(BaseModel):
    """A semantic-search hit (ticket or customer)."""

    kind: str
    ref_id: int
    label: str
    text: str
    distance: float


class BriefingOut(BaseModel):
    """Daily operations briefing — narrative summary + the structured attention lists."""

    date: str
    summary: str
    used_llm: bool = False
    overdue_assignments: list[dict] = []
    mr_pending_closed: list[dict] = []
    pms_due: list[dict] = []
    payments_pending: list[dict] = []
