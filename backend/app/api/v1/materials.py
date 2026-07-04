"""Materials catalog (Materials Database master)."""

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select

from app.api.deps import SessionDep, get_current_user, require_admin
from app.models.masters import MaterialItem
from app.schemas.masters import MaterialItemCreate, MaterialItemRead

router = APIRouter(
    prefix="/materials", tags=["materials"], dependencies=[Depends(get_current_user)]
)


@router.get("", response_model=list[MaterialItemRead])
def list_materials(session: SessionDep):
    return session.exec(select(MaterialItem).order_by(MaterialItem.name)).all()


@router.post("", response_model=MaterialItemRead, status_code=201, dependencies=[Depends(require_admin)])
def create_material(payload: MaterialItemCreate, session: SessionDep):
    item = MaterialItem(**payload.model_dump())
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@router.delete("/{item_id}", status_code=204, dependencies=[Depends(require_admin)])
def delete_material(item_id: int, session: SessionDep):
    item = session.get(MaterialItem, item_id)
    if not item:
        raise HTTPException(404, "Material not found")
    session.delete(item)
    session.commit()
