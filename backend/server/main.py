import subprocess
from fastapi import FastAPI, Depends
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

from models import Base, ExecResult
from database import engine, get_db
from sqlalchemy.orm import Session

Base.metadata.create_all(bind=engine)

app = FastAPI()

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["GET", "POST"],
)

# Define schemas
class CodeInput(BaseModel):
    code: str
    stdin: str
    isSubmit: bool

class CodeOutput(BaseModel):
    result: str
    status: int

# runcode enpoint handles code run requests sent by the user
@app.post("/runcode", response_model=CodeOutput)
async def handle_run_code(code_input: CodeInput, db: Session = Depends(get_db)):
    try:
        result = subprocess.check_output(['python3', '-c', code_input.code] + code_input.stdin.split(), text=True, timeout=10, stderr=subprocess.STDOUT)
        # Saves code and results for valid submissions
        if code_input.isSubmit:
            db.add(ExecResult(src=code_input.code, stdin=code_input.stdin, res=result))
            db.commit()
        return {"result": result, "status": 0}
    # Gracefully handles error and returns error outputs to the user
    except subprocess.CalledProcessError as e:
        return {"result": str(e.output), "status": 1}
