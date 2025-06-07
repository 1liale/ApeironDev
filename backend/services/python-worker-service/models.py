from typing import Optional, List
from pydantic import BaseModel, Field

class CloudTaskPayload(BaseModel):
    job_id: str
    code: str
    language: str # Language field, though python-worker only handles python
    input: Optional[str] = None

class WorkerFile(BaseModel):
    r2_object_key: str = Field(..., alias="r2_object_key")
    file_path: str = Field(..., alias="file_path")

class CloudTaskAuthPayload(BaseModel):
    job_id: str
    workspace_id: str
    entrypoint_file: str
    language: str
    input: Optional[str] = None
    r2_bucket_name: str
    files: List[WorkerFile]

# Optional: A common model for updating Firestore job status
class JobStatusUpdate(BaseModel):
    status: str
    output: Optional[str] = None
    error: Optional[str] = None

class CodeExecutionResult(BaseModel):
    output: Optional[str] = None
    error: Optional[str] = None
    status_code: int # 0: success, 1: runtime error, 2: timeout, 3: internal error 