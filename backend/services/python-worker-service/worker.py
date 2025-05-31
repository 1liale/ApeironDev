import subprocess
import os
import resource
import logging
import uvicorn
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from google.cloud import datastore
from models import CloudTaskPayload

# Environment Variables
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID")
DATASTORE_KIND_JOBS = os.getenv("DATASTORE_KIND_JOBS", "Job")
DEFAULT_EXECUTION_TIMEOUT_SEC = int(os.getenv("DEFAULT_EXECUTION_TIMEOUT_SEC", "10"))
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

app = FastAPI()
datastore_client = None

logging.basicConfig(level=LOG_LEVEL, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

if not GCP_PROJECT_ID:
    logger.critical("GCP_PROJECT_ID environment variable not set. Datastore client cannot be initialized.")
    # The service will likely be unhealthy and fail requests needing Datastore.

@app.on_event("startup")
async def startup_event():
    global datastore_client
    if GCP_PROJECT_ID:
        try:
            datastore_client = datastore.Client(project=GCP_PROJECT_ID)
            logger.info(f"Datastore client initialized for project {GCP_PROJECT_ID}.")
        except Exception as e:
            logger.critical(f"Failed to initialize Datastore client: {e}", exc_info=True)
    else:
        logger.warning("Datastore client not initialized due to missing GCP_PROJECT_ID.")

def set_execution_limits(
    cpu_time_sec: int = 5, 
    memory_mb: int = 256, 
    max_processes: int = 1, 
    max_file_size_mb: int = 10,
):
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_time_sec, cpu_time_sec))
        resource.setrlimit(resource.RLIMIT_AS, (memory_mb * 1024 * 1024, memory_mb * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NPROC, (max_processes, max_processes))
        resource.setrlimit(resource.RLIMIT_FSIZE, (max_file_size_mb * 1024 * 1024, max_file_size_mb * 1024 * 1024))
    except Exception as e:
        logger.error(f"Failed to set resource limits: {e}") # exc_info=True can be noisy for this

def execute_python_code(job_id: str, code: str, input_data: str) -> tuple[str | None, str | None, int]:
    """Executes python code. Returns: (output, error_details, status_code)."""
    # status_codes: 0=success, 1=user_code_error, 2=timeout, 3=internal_worker_error
    logger.debug(f"Executing code for job_id: {job_id}")
    try:
        process = subprocess.run(
            ['python3', '-c', code],
            input=input_data,
            text=True,
            timeout=DEFAULT_EXECUTION_TIMEOUT_SEC,
            capture_output=True,
            preexec_fn=set_execution_limits
        )
        if process.returncode == 0:
            return process.stdout, None, 0
        else:
            error_output = process.stderr if process.stderr else process.stdout
            logger.warning(f"Job {job_id} user code error (rc={process.returncode}): {error_output[:300]}...")
            return None, error_output, 1
    except subprocess.TimeoutExpired:
        logger.warning(f"Job {job_id} execution timed out after {DEFAULT_EXECUTION_TIMEOUT_SEC}s.")
        return None, f"Execution timed out after {DEFAULT_EXECUTION_TIMEOUT_SEC} seconds.", 2
    except Exception as e:
        logger.error(f"Job {job_id} internal error during code execution: {e}", exc_info=LOG_LEVEL=="DEBUG") # Only full stack trace if DEBUG
        return None, f"Internal worker error during execution: {str(e)}", 3

@app.post("/execute")
async def execute_task_endpoint(payload: CloudTaskPayload, request: Request):
    # Log the Authorization header
    auth_header = request.headers.get('Authorization')
    logger.info(f"Received Authorization header: {auth_header}")

    job_id = payload.job_id
    logger.info(f"Processing job_id: {job_id}, lang: {payload.language}")

    if not datastore_client:
        logger.error(f"Job {job_id}: Datastore client not available. Task cannot be processed.")
        raise HTTPException(status_code=503, detail="Worker service unavailable: Datastore not configured.")

    key = datastore_client.key(DATASTORE_KIND_JOBS, job_id)

    try:
        with datastore_client.transaction():
            entity = datastore_client.get(key)
            if entity:
                entity["status"] = "processing"
                entity["processing_started_at"] = datetime.now(timezone.utc)
                datastore_client.put(entity)
            else:
                logger.warning(f"Job {job_id}: Document not found in Datastore for update to 'processing'. This might happen if the API service hasn't created it yet or if there's a race condition.")
                # Potentially create it here if it must exist, or rely on API service to have created it.
                # For now, we'll assume API service creates it.
    except Exception as e:
        logger.error(f"Job {job_id}: Failed to update Datastore to 'processing': {e}")
        # Proceeding, but this job might seem stuck in "queued" if initial GET was fast.

    if payload.language.lower() != "python":
        logger.warning(f"Job {job_id}: Language '{payload.language}' specified; worker executes as Python.")

    output, error_details, exec_status_code = execute_python_code(job_id, payload.code, payload.input or "")

    # Prepare data for Datastore update
    # We will update the existing entity or create it if it somehow wasn't found before
    # Using a transaction for the final update is good practice.
    try:
        with datastore_client.transaction():
            entity = datastore_client.get(key) # Get the latest version
            if not entity:
                # This case should be rare if the API service creates the job entry first.
                # If it can happen, initialize a new entity.
                logger.warning(f"Job {job_id}: Entity not found before final update. Creating a new one.")
                entity = datastore.Entity(key=key)
                # Populate fields that api-service would have set, if necessary, or rely on partial update
                entity["job_id"] = job_id # Though key contains it
                entity["language"] = payload.language
                entity["code"] = payload.code # Consider if needed
                entity["input"] = payload.input
                # entity["submitted_at"] = datetime.now(timezone.utc) # Or fetch from API if possible
            
            entity["completed_at"] = datetime.now(timezone.utc)

            if exec_status_code == 0:
                entity["status"] = "completed"
                entity["output"] = output
                logger.info(f"Job {job_id}: Execution successful.")
            else:
                entity["status"] = "failed"
                entity["error"] = error_details

                if exec_status_code == 1:
                    logger.warning(f"Job {job_id}: Execution failed (user code error). Details in Datastore.")
                elif exec_status_code == 2:
                    logger.warning(f"Job {job_id}: Execution failed (timeout). Details in Datastore.")
                elif exec_status_code == 3:
                    logger.error(f"Job {job_id}: Execution failed (internal worker error). Details in Datastore.")
            
            datastore_client.put(entity)

    except Exception as e:
        logger.critical(f"Job {job_id}: FAILED TO SAVE FINAL RESULTS to Datastore: {e}. Data may be lost.", exc_info=True)
        # Critical: Job ran, but results not saved. Return 500 to signal infra issue.
        raise HTTPException(status_code=500, detail=f"Critical error saving results for job {job_id}.")

    return {"job_id": job_id, "message": "Execution task processed."}

# @app.get("/health")
# async def health_check():
#     if GCP_PROJECT_ID and datastore_client:
#         # Perform a quick check, e.g., try to get a non-existent document metadata (fast, low cost)
#         try:
#             key = datastore_client.key(DATASTORE_KIND_JOBS, "__healthcheck__")
#             datastore_client.get(key) # Raises google.cloud.exceptions.NotFound if not found, which is fine.
#             return {"status": "healthy", "datastore_status": "connected"}
#         except Exception as e:
#             if "NotFound" in str(e): # Crude check for NotFound exception
#                 return {"status": "healthy", "datastore_status": "connected (test_key_not_found)"}
#             logger.warning(f"Health check: Datastore connectivity issue: {e}")
#             return {"status": "degraded", "datastore_status": "connectivity_issue"}, 503
#     elif GCP_PROJECT_ID and not datastore_client:
#          logger.warning("Health check: Datastore client not initialized (startup failed?).")
#          return {"status": "unhealthy", "datastore_status": "disconnected (initialization_failed)"}, 503
#     else:
#         logger.error("Health check: GCP_PROJECT_ID not configured.")
#         return {"status": "unhealthy", "datastore_status": "GCP_PROJECT_ID_not_configured"}, 503

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    logger.info(f"Starting Python worker service locally on port {port} with log level {LOG_LEVEL}")
  
    uvicorn.run(app, host="0.0.0.0", port=port) 