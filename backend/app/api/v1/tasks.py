"""Tasks — Service Admin / Engineer assign; the assignee works their own.

Visibility: Admin/Engineer see all tasks; everyone else sees only tasks assigned
to them. Status updates: the assignee can update their own task; Admin/Engineer
can update any task or field.
"""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status as http_status
from sqlmodel import select

from app.api.deps import CurrentUser, SessionDep, get_current_user, require_engineer
from app.core.enums import TaskPriority, TaskStatus
from app.models.task import Task
from app.models.tickets import Ticket
from app.models.user import User
from app.schemas.task import AssigneeRead, TaskCreate, TaskRead, TaskUpdate
from app.services.notifications import notify
from app.services.permissions import is_privileged

router = APIRouter(prefix="/tasks", tags=["tasks"], dependencies=[Depends(get_current_user)])


@router.get("/assignees", response_model=list[AssigneeRead], dependencies=[Depends(require_engineer)])
def list_assignees(session: SessionDep):
    """Active users a task can be assigned to (Admin/Engineer only)."""
    users = session.exec(select(User).where(User.is_active == True)).all()  # noqa: E712
    return [
        AssigneeRead(id=u.id, label=(u.full_name or u.username), role=u.role.value)
        for u in sorted(users, key=lambda u: (u.full_name or u.username).lower())
    ]


def _to_read(session: SessionDep, t: Task) -> TaskRead:
    assignee = session.get(User, t.assignee_user_id)
    assigner = session.get(User, t.assigned_by_user_id) if t.assigned_by_user_id else None
    ticket = session.get(Ticket, t.ticket_id) if t.ticket_id else None
    overdue = (
        t.status != TaskStatus.DONE
        and t.due_date is not None
        and t.due_date < date.today()
    )
    return TaskRead(
        id=t.id,
        title=t.title,
        description=t.description,
        assignee_user_id=t.assignee_user_id,
        assigned_by_user_id=t.assigned_by_user_id,
        ticket_id=t.ticket_id,
        priority=t.priority,
        due_date=t.due_date,
        status=t.status,
        created_at=t.created_at,
        assignee_name=(assignee.full_name or assignee.username) if assignee else None,
        assigned_by_name=(assigner.full_name or assigner.username) if assigner else None,
        ticket_no=ticket.ticket_no if ticket else None,
        overdue=overdue,
    )


@router.get("", response_model=list[TaskRead])
def list_tasks(
    session: SessionDep,
    user: CurrentUser,
    status: TaskStatus | None = None,
    priority: TaskPriority | None = None,
    assignee_user_id: int | None = None,
):
    stmt = select(Task)
    # Non-privileged users only see their own tasks.
    if not is_privileged(user):
        stmt = stmt.where(Task.assignee_user_id == user.id)
    elif assignee_user_id:
        stmt = stmt.where(Task.assignee_user_id == assignee_user_id)
    if status:
        stmt = stmt.where(Task.status == status)
    if priority:
        stmt = stmt.where(Task.priority == priority)
    tasks = session.exec(stmt.order_by(Task.id.desc())).all()
    return [_to_read(session, t) for t in tasks]


@router.post("", response_model=TaskRead, status_code=201, dependencies=[Depends(require_engineer)])
def create_task(payload: TaskCreate, session: SessionDep, user: CurrentUser):
    assignee = session.get(User, payload.assignee_user_id)
    if not assignee or not assignee.is_active:
        raise HTTPException(404, "Assignee user not found or inactive")
    if payload.ticket_id and not session.get(Ticket, payload.ticket_id):
        raise HTTPException(404, "Ticket not found")

    task = Task(
        title=payload.title,
        description=payload.description,
        assignee_user_id=payload.assignee_user_id,
        assigned_by_user_id=user.id,
        ticket_id=payload.ticket_id,
        priority=payload.priority,
        due_date=payload.due_date,
        status=TaskStatus.OPEN,
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    if task.assignee_user_id != user.id:
        notify(
            session, task.assignee_user_id, "task_assigned",
            title=f"New task: {task.title}",
            body=f"Assigned by {user.full_name or user.username}"
            + (f" · due {task.due_date.isoformat()}" if task.due_date else ""),
            link="/tasks",
        )
    return _to_read(session, task)


@router.patch("/{task_id}", response_model=TaskRead)
def update_task(task_id: int, payload: TaskUpdate, session: SessionDep, user: CurrentUser):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")

    data = payload.model_dump(exclude_unset=True)
    prev_assignee = task.assignee_user_id
    prev_status = task.status
    if is_privileged(user):
        # Admin/Engineer may edit anything.
        if "assignee_user_id" in data and data["assignee_user_id"] is not None:
            if not session.get(User, data["assignee_user_id"]):
                raise HTTPException(404, "Assignee user not found")
        if data.get("ticket_id") and not session.get(Ticket, data["ticket_id"]):
            raise HTTPException(404, "Ticket not found")
    else:
        # Assignee may only update the status of their own task.
        if task.assignee_user_id != user.id:
            raise HTTPException(http_status.HTTP_403_FORBIDDEN, "Not your task")
        if set(data.keys()) - {"status"}:
            raise HTTPException(http_status.HTTP_403_FORBIDDEN, "You may only update status")

    for key, value in data.items():
        setattr(task, key, value)
    session.add(task)
    session.commit()
    session.refresh(task)

    # Re-assigned to someone new → notify them.
    if task.assignee_user_id != prev_assignee and task.assignee_user_id != user.id:
        notify(
            session, task.assignee_user_id, "task_assigned",
            title=f"Task assigned to you: {task.title}",
            body=f"Assigned by {user.full_name or user.username}",
            link="/tasks",
        )
    # Marked done → notify whoever raised it.
    if (
        task.status == TaskStatus.DONE and prev_status != TaskStatus.DONE
        and task.assigned_by_user_id and task.assigned_by_user_id != user.id
    ):
        notify(
            session, task.assigned_by_user_id, "task_completed",
            title=f"Task completed: {task.title}",
            body=f"Completed by {user.full_name or user.username}",
            link="/tasks",
        )
    return _to_read(session, task)


@router.delete("/{task_id}", status_code=204, dependencies=[Depends(require_engineer)])
def delete_task(task_id: int, session: SessionDep):
    task = session.get(Task, task_id)
    if not task:
        raise HTTPException(404, "Task not found")
    session.delete(task)
    session.commit()
