from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import func, select

from app.api.deps import SessionDep, get_current_user, require_admin
from app.models.masters import Customer
from app.models.pms import PMS
from app.models.tickets import Ticket
from app.schemas.masters import CustomerCreate, CustomerRead

router = APIRouter(
    prefix="/customers", tags=["customers"], dependencies=[Depends(get_current_user)]
)


def _amc_customer_ids(session: SessionDep) -> set[int]:
    """Customers with a PMS work order active today (start <= today <= end).

    A WO with no end date does not count as active.
    """
    today = date.today()
    rows = session.exec(
        select(PMS.customer_id).where(
            PMS.wo_start_date.is_not(None),
            PMS.wo_start_date <= today,
            PMS.wo_end_date.is_not(None),
            PMS.wo_end_date >= today,
        )
    ).all()
    return set(rows)


def _contract_status(customer: Customer, amc_ids: set[int], today: date) -> str:
    """WTY during the warranty period; else AMC if an active PMS WO exists; else NIC.

    Warranty takes precedence — after the warranty period a customer moves to AMC or NIC.
    """
    ws, we = customer.warranty_start_date, customer.warranty_end_date
    if we is not None and we >= today and (ws is None or ws <= today):
        return "WTY"
    if customer.id in amc_ids:
        return "AMC"
    return "NIC"


def _read(customer: Customer, amc_ids: set[int], today: date) -> CustomerRead:
    status = _contract_status(customer, amc_ids, today)
    data = customer.model_dump()
    data["is_amc"] = status == "AMC"
    return CustomerRead(**data, contract_status=status)


@router.get("", response_model=list[CustomerRead])
def list_customers(session: SessionDep, q: str | None = None):
    stmt = select(Customer)
    if q:
        stmt = stmt.where(Customer.name.ilike(f"%{q}%"))
    customers = session.exec(stmt.order_by(Customer.name)).all()
    amc = _amc_customer_ids(session)
    today = date.today()
    return [_read(c, amc, today) for c in customers]


@router.post("", response_model=CustomerRead, status_code=201, dependencies=[Depends(require_admin)])
def create_customer(payload: CustomerCreate, session: SessionDep):
    customer = Customer(**payload.model_dump())
    session.add(customer)
    session.commit()
    session.refresh(customer)
    return _read(customer, _amc_customer_ids(session), date.today())


@router.get("/{customer_id}", response_model=CustomerRead)
def get_customer(customer_id: int, session: SessionDep):
    customer = session.get(Customer, customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")
    return _read(customer, _amc_customer_ids(session), date.today())


@router.put("/{customer_id}", response_model=CustomerRead, dependencies=[Depends(require_admin)])
def update_customer(customer_id: int, payload: CustomerCreate, session: SessionDep):
    customer = session.get(Customer, customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")
    for key, value in payload.model_dump().items():
        setattr(customer, key, value)
    session.add(customer)
    session.commit()
    session.refresh(customer)
    return _read(customer, _amc_customer_ids(session), date.today())


@router.delete("/{customer_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_customer(customer_id: int, session: SessionDep):
    customer = session.get(Customer, customer_id)
    if not customer:
        raise HTTPException(404, "Customer not found")

    # Block deletion while history references this customer (tickets / PMS).
    ticket_count = session.exec(
        select(func.count()).select_from(Ticket).where(Ticket.customer_id == customer_id)
    ).one()
    pms_count = session.exec(
        select(func.count()).select_from(PMS).where(PMS.customer_id == customer_id)
    ).one()
    if ticket_count or pms_count:
        parts = []
        if ticket_count:
            parts.append(f"{ticket_count} ticket(s)")
        if pms_count:
            parts.append(f"{pms_count} PMS work order(s)")
        raise HTTPException(
            409,
            f"Cannot delete '{customer.name}' — linked to {' and '.join(parts)}.",
        )

    session.delete(customer)
    session.commit()
