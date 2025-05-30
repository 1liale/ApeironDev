from typing import Optional
from pydantic import BaseModel

class CloudTaskPayload(BaseModel):
    job_id: str
    code: str
    language: str # Language field, though python-worker only handles python
    input: str = ""

class CodeExecutionResult(BaseModel):
    output: Optional[str] = None
    error: Optional[str] = None
    status_code: int # 0: success, 1: runtime error, 2: timeout, 3: internal error 