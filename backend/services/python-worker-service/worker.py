import subprocess
import os
import resource
import logging
import uvicorn

from fastapi import FastAPI, HTTPException, Request
from models import CodeExecutionRequest, CodeExecutionResult

PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "your-gcp-project")
GCS_BUCKET_NAME = os.getenv("GCS_BUCKET_NAME", "your-code-execution-bucket") # Example GCS bucket name
DEFAULT_EXECUTION_TIMEOUT_SEC = 10 # Default execution timeout in seconds

app = FastAPI()

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO").upper(), format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def set_execution_limits(
    cpu_time_sec: int = 5, # 5 secs of CPU time
    memory_mb: int = 256, # 256 MB of virtual memory
    max_processes: int = 1, # Allow only one process to be created
    max_file_size_mb: int = 10, # 10MB limit
):
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_time_sec, cpu_time_sec))
        resource.setrlimit(resource.RLIMIT_AS, (memory_mb * 1024 * 1024, memory_mb * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NPROC, (max_processes, max_processes))
        resource.setrlimit(resource.RLIMIT_FSIZE, (max_file_size_mb * 1024 * 1024, max_file_size_mb * 1024 * 1024))
    except Exception as e:
        logger.error(f"Failed to set resource limits: {e}", exc_info=True)

def execute_python_code(job_id: str, code: str, input_data: str) -> CodeExecutionResult:
    logger.info(f"Executing code for job_id: {job_id}")
    try:
        process = subprocess.run(
            ['python3', '-c', code],
            input=input_data,
            text=True,
            timeout=DEFAULT_EXECUTION_TIMEOUT_SEC,  # Wall-clock timeout for the subprocess
            capture_output=True,
            preexec_fn=set_execution_limits
        )
        if process.returncode == 0:
            return CodeExecutionResult(output=process.stdout, status_code=0)
        else:
            error_output = process.stderr if process.stderr else process.stdout
            logger.warning(f"Job {job_id}: execution error: {error_output[:200]}")
            return CodeExecutionResult(output="", error=error_output, status_code=1)
    except subprocess.TimeoutExpired:
        logger.warning(f"Job {job_id}: execution timed out.")
        return CodeExecutionResult(output="", error=f"Execution timed out after {DEFAULT_EXECUTION_TIMEOUT_SEC} seconds.", status_code=2)
    except Exception as e:
        logger.error(f"Job {job_id}: unexpected execution error: {e}", exc_info=True)
        return CodeExecutionResult(output="", error=f"An unexpected server error occurred.", status_code=3)

def save_output_to_gcs(job_id: str, result: CodeExecutionResult):
    # STUB: Implement GCS upload logic here
    logger.info(f"Job {job_id}: GCS save stub (status: {result.status_code}). Output: {result.output[:50]}... Error: {result.error[:50]}...")
    # try:
    #     # Actual GCS client and upload calls
    # except Exception as e:
    #     logger.error(f"Job {job_id}: Failed to save to GCS: {e}", exc_info=True)
    pass

@app.post("/execute")
async def execute_task_endpoint(payload: CodeExecutionRequest):
    logger.info(f"Received execution request for job_id: {payload.job_id}")

    execution_result = execute_python_code(payload.job_id, payload.code, payload.input_data or "")
    save_output_to_gcs(payload.job_id, execution_result)

    if execution_result.status_code == 3: # Internal server error during execution attempt
        # This indicates a problem with the worker/sandboxing, not user code typically.
        raise HTTPException(status_code=500, detail=f"Internal error during code execution: {execution_result.error}")
    
    logger.info(f"Job {payload.job_id}: Processed. Execution status: {execution_result.status_code}.")
    return {
        "job_id": payload.job_id,
        "message": "Execution task processed.",
        "execution_status_code": execution_result.status_code,
        "output_snippet": (execution_result.output[:100] + '...') if execution_result.output and len(execution_result.output) > 100 else execution_result.output,
        "error_snippet": (execution_result.error[:100] + '...') if execution_result.error and len(execution_result.error) > 100 else execution_result.error,
    }

@app.get("/health")
async def health_check():
    logger.debug("Health check endpoint hit")
    return {"status": "Python worker is healthy"}

# For local development, not used by `uvicorn` CMD in Dockerfile
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    log_level = os.environ.get("LOG_LEVEL", "info").lower()
    logger.info(f"Starting Python worker service on port {port} with log level {log_level}")
    uvicorn.run(app, host="0.0.0.0", port=port, log_level=log_level) 