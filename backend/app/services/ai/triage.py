"""Auto-triage a free-text breakdown complaint into ticket fields (fallback-first).

Given what a customer said ("VRF not cooling, gas leak"), suggest the work type, machine type,
the closest complaint from the master, a priority, and the derived skill. Deterministic keyword
matching always produces a result; the local LLM only refines it when available. Nothing here can
invent values — the LLM is constrained to the actual master lists, and anything it returns is
validated back against them. The user reviews every suggestion before creating the ticket.
"""

from __future__ import annotations

from sqlmodel import Session, select

from app.core.enums import ComplaintType, MachineType, WorkType
from app.models.masters import Complaint
from app.services.ticket_logic import derive_skill

# Keywords that hint the machine type when the complaint doesn't name it explicitly.
_MACHINE_HINTS: dict[MachineType, tuple[str, ...]] = {
    MachineType.VRF: ("vrf", "outdoor unit", "odu"),
    MachineType.DUCTABLE: ("ductable", "ducted", "duct"),
    MachineType.PACKAGE: ("package", "packaged"),
    MachineType.CHILLER: ("chiller", "chilled water"),
    MachineType.SPLIT: ("split", "hi-wall", "hi wall"),
    MachineType.CASSETTE: ("cassette",),
    MachineType.AHU: ("ahu", "air handling"),
}

# Words that push priority up (urgent / high-impact sites).
_URGENT = ("urgent", "immediately", "asap", "not working", "no cooling", "not cooling",
           "shutdown", "down", "breakdown", "hospital", "server", "gas leak", "tripping", "burnt")

_WORKTYPE_HINTS: dict[WorkType, tuple[str, ...]] = {
    WorkType.PMS: ("pms", "preventive", "routine service", "amc visit"),
    WorkType.REPAIRED_SERVICE: ("repair", "chargeable", "estimate", "quotation"),
    WorkType.SERVICE: ("service", "general service", "cleaning"),
}

_PRIORITY_BY_TYPE = {
    ComplaintType.MAJOR_BREAKDOWN: "High",
    ComplaintType.MINOR_BREAKDOWN: "Normal",
    ComplaintType.COMMISSIONING: "Low",
}


def _detect_machine(text: str) -> MachineType | None:
    low = text.lower()
    for mt, hints in _MACHINE_HINTS.items():
        if any(h in low for h in hints):
            return mt
    return None


def _detect_work_type(text: str) -> WorkType:
    low = text.lower()
    for wt, hints in _WORKTYPE_HINTS.items():
        if any(h in low for h in hints):
            return wt
    return WorkType.BREAKDOWN  # default: an inbound call is usually a breakdown


def _best_complaint(text: str, complaints: list[Complaint]) -> Complaint | None:
    """Score each master complaint by how many of its name-words appear in the text."""
    low = text.lower()
    best: tuple[int, Complaint] | None = None
    for c in complaints:
        words = [w for w in c.name.lower().replace("-", " ").split() if len(w) > 2]
        score = sum(1 for w in words if w in low)
        if score and (best is None or score > best[0]):
            best = (score, c)
    return best[1] if best else None


def triage(session: Session, text: str, machine_type: str | None = None) -> dict:
    complaints = list(session.exec(select(Complaint)).all())
    by_name = {c.name.lower(): c for c in complaints}

    # ---- deterministic baseline ----
    mt: MachineType | None = None
    if machine_type:
        try:
            mt = MachineType(machine_type)
        except ValueError:
            mt = None
    mt = mt or _detect_machine(text)
    work_type = _detect_work_type(text)
    match = _best_complaint(text, complaints)
    low = text.lower()
    urgent = any(w in low for w in _URGENT)

    result = {
        "work_type": work_type.value,
        "machine_type": mt.value if mt else None,
        "primary_complaint": match.name if match else None,
        "complaint_type": match.complaint_type.value if match else None,
        "priority": "High" if urgent else (_PRIORITY_BY_TYPE.get(match.complaint_type, "Normal") if match else "Normal"),
        "rationale": None,
        "source": "fallback",
    }

    # ---- LLM refinement (optional, constrained to the master lists) ----
    try:
        from app.services.ai.llm import chat, llm_available

        if llm_available() and text.strip():
            names = ", ".join(sorted(c.name for c in complaints))
            machines = ", ".join(m.value for m in MachineType)
            works = ", ".join(w.value for w in WorkType)
            reply = chat(
                system=(
                    "You triage HVAC service calls for a Blue Star dealer. From the customer's "
                    "words, choose the single best matching complaint and machine type. You MUST "
                    "pick values only from the provided lists (or null if truly unclear). "
                    "Return JSON with keys: work_type, machine_type, primary_complaint, priority "
                    "(High|Normal|Low), rationale (one short sentence)."
                ),
                user=(
                    f"Customer said: {text}\n\n"
                    f"Allowed work_type: {works}\n"
                    f"Allowed machine_type: {machines}\n"
                    f"Allowed primary_complaint: {names}"
                ),
                json_mode=True,
                operation="triage",
            )
            if reply:
                import json

                data = json.loads(reply)
                wt = data.get("work_type")
                if wt in {w.value for w in WorkType}:
                    result["work_type"] = wt
                m = data.get("machine_type")
                if m in {mm.value for mm in MachineType}:
                    result["machine_type"] = m
                pc = data.get("primary_complaint")
                if isinstance(pc, str) and pc.lower() in by_name:
                    c = by_name[pc.lower()]
                    result["primary_complaint"] = c.name
                    result["complaint_type"] = c.complaint_type.value
                pr = data.get("priority")
                if pr in {"High", "Normal", "Low"}:
                    result["priority"] = pr
                rat = data.get("rationale")
                if isinstance(rat, str) and rat.strip():
                    result["rationale"] = rat.strip()[:200]
                result["source"] = "llm"
    except Exception:  # noqa: BLE001 — any LLM/parse failure keeps the deterministic result
        pass

    # ---- derive the skill from the (possibly refined) complaint + machine ----
    ct = result["complaint_type"]
    mtv = result["machine_type"]
    if ct and mtv:
        try:
            result["skill"] = derive_skill(ct, MachineType(mtv))
        except ValueError:
            result["skill"] = None
    else:
        result["skill"] = None

    return result
