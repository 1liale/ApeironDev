import subprocess
from fastapi import FastAPI
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["GET", "POST"],
)

# uses pydantic to validation data of HTTP request body
class CodeInput(BaseModel):
    code: str
    stdin: str
    isSubmit: bool

class CodeOutput(BaseModel):
    result: str
    status: int

# runcode enpoint handles code run requests sent by the user
@app.post("/runcode", response_model=CodeOutput)
async def handle_run_code(code_input: CodeInput):
    try:
        result = subprocess.check_output(['python3', '-c', code_input.code] + code_input.stdin.split(), text=True, timeout=10, stderr=subprocess.STDOUT)
        # saves code and results for valid submissions
        if code_input.isSubmit:
            pass
        return {"result": result, "status": 0}
    # gracefully handles error and returns error outputs to the user
    except subprocess.CalledProcessError as e:
        return {"result": str(e.output), "status": 1}
