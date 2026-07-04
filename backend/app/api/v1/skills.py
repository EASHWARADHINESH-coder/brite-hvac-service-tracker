from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select

from app.api.deps import SessionDep, get_current_user, require_admin
from app.models.masters import Skill
from app.schemas.masters import SkillCreate, SkillRead

router = APIRouter(prefix="/skills", tags=["skills"], dependencies=[Depends(get_current_user)])


@router.get("", response_model=list[SkillRead])
def list_skills(session: SessionDep):
    return session.exec(select(Skill).order_by(Skill.name)).all()


@router.post("", response_model=SkillRead, status_code=201, dependencies=[Depends(require_admin)])
def create_skill(payload: SkillCreate, session: SessionDep):
    if session.exec(select(Skill).where(Skill.name == payload.name)).first():
        raise HTTPException(409, "Skill already exists")
    skill = Skill(**payload.model_dump())
    session.add(skill)
    session.commit()
    session.refresh(skill)
    return skill


@router.delete("/{skill_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_skill(skill_id: int, session: SessionDep):
    skill = session.get(Skill, skill_id)
    if not skill:
        raise HTTPException(404, "Skill not found")
    session.delete(skill)
    session.commit()
