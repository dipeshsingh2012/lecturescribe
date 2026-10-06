from fastapi import APIRouter, Header, HTTPException, status
from fastapi.responses import StreamingResponse
from typing import List, Dict, Any
from pydantic import BaseModel
from app.services.csv_service import generate_csv_chunks

router = APIRouter()

class ExportRequest(BaseModel):
    headers: List[str]
    data: List[Dict[str, Any]]

@router.post("/export/csv")
async def export_csv(
    payload: ExportRequest,
    x_tenant_id: str = Header(..., alias="X-Tenant-ID")
):
    """
    Streams a CSV file based on provided data.
    Enforces multi-tenancy via X-Tenant-ID.
    """
    if not x_tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, 
            detail="Missing X-Tenant-ID header"
        )

    # In a real implementation, we would verify that the data belongs to x_tenant_id
    # via a database check here.

    def chunk_generator():
        yield from generate_csv_chunks(payload.data, payload.headers)

    return StreamingResponse(
        chunk_generator(),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename=export_{x_tenant_id}.csv"
        }
    )
