from typing import Optional
from pydantic import BaseModel

class CloudTaskPayload(BaseModel):
    job_id: str
    code: str
    language: str # Language field, though python-worker only handles python
    input: Optional[str] = None

class CloudTaskAuthPayload(BaseModel):
    job_id: str
    workspace_id: str
    entrypoint_file: str
    language: str
    input: Optional[str] = None
    r2_bucket_name: str

# Optional: A common model for updating Firestore job status
class JobStatusUpdate(BaseModel):
    status: str
    output: Optional[str] = None
    error: Optional[str] = None

class CodeExecutionResult(BaseModel):
    output: Optional[str] = None
    error: Optional[str] = None
    status_code: int # 0: success, 1: runtime error, 2: timeout, 3: internal error 