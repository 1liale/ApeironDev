import subprocess
import os
import resource
import logging
import uvicorn
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException, Request
from google.cloud import firestore
from models import CloudTaskPayload

# Environment Variables
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID")
COLLECTION_ID_JOBS = os.getenv("COLLECTION_ID_JOBS", "Job")
DEFAULT_EXECUTION_TIMEOUT_SEC = int(os.getenv("DEFAULT_EXECUTION_TIMEOUT_SEC", "10"))
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

app = FastAPI()
firestore_client = None

logging.basicConfig(level=LOG_LEVEL, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

if not GCP_PROJECT_ID:
    logger.critical("GCP_PROJECT_ID environment variable not set. Firestore client cannot be initialized.")

@app.on_event("startup")
async def startup_event():
    global firestore_client
    if GCP_PROJECT_ID:
        try:
            firestore_client = firestore.Client(project=GCP_PROJECT_ID)
            logger.info(f"Firestore client initialized for project {GCP_PROJECT_ID}.")
        except Exception as e:
            logger.critical(f"Failed to initialize Firestore client: {e}", exc_info=True)
    else:
        logger.warning("Firestore client not initialized due to missing GCP_PROJECT_ID.")

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

@firestore.transactional
def update_job_in_transaction(transaction, job_ref, update_data):
    """Updates job document within a Firestore transaction."""
    transaction.update(job_ref, update_data)

@app.post("/execute")
async def execute_task_endpoint(payload: CloudTaskPayload, request: Request):
    auth_header = request.headers.get('Authorization')
    logger.info(f"Received Authorization header: {auth_header}")

    job_id = payload.job_id
    logger.info(f"Processing job_id: {job_id}, lang: {payload.language}")

    if not firestore_client:
        logger.error(f"Job {job_id}: Firestore client not available. Task cannot be processed.")
        raise HTTPException(status_code=503, detail="Worker service unavailable: Firestore not configured.")

    job_doc_ref = firestore_client.collection(COLLECTION_ID_JOBS).document(job_id)

    # Update status to "processing"
    processing_update = {
        "status": "processing",
        "processing_started_at": datetime.now(timezone.utc)
    }
    try:
        transaction = firestore_client.transaction()
        update_job_in_transaction(transaction, job_doc_ref, processing_update)
        logger.info(f"Job {job_id}: Status updated to 'processing' in Firestore.")
    except Exception as e:
        logger.error(f"Job {job_id}: Failed to update Firestore to 'processing' status (doc might not exist or other error): {e}")

    if payload.language.lower() != "python":
        logger.warning(f"Job {job_id}: Language '{payload.language}' specified; worker executes as Python.")

    output, error_details, exec_status_code = execute_python_code(job_id, payload.code, payload.input or "")

    # Prepare final data for Firestore update
    final_update_data = {
        "completed_at": datetime.now(timezone.utc)
    }

    if exec_status_code == 0:
        final_update_data["status"] = "completed"
        final_update_data["output"] = output
        logger.info(f"Job {job_id}: Execution successful.")
    else:
        final_update_data["status"] = "failed"
        final_update_data["error"] = error_details
        if exec_status_code == 1:
            logger.warning(f"Job {job_id}: Execution failed (user code error). Details in Firestore.")
        elif exec_status_code == 2:
            logger.warning(f"Job {job_id}: Execution failed (timeout). Details in Firestore.")
        elif exec_status_code == 3:
            logger.error(f"Job {job_id}: Execution failed (internal worker error). Details in Firestore.")

    try:
        transaction = firestore_client.transaction()
        update_job_in_transaction(transaction, job_doc_ref, final_update_data)
        logger.info(f"Job {job_id}: Final results saved to Firestore.")
    except Exception as e:
        logger.critical(f"Job {job_id}: FAILED TO SAVE FINAL RESULTS to Firestore: {e}. Data may be lost.", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Critical error saving results for job {job_id}.")

    return {"job_id": job_id, "message": "Execution task processed."}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    logger.info(f"Starting Python worker service locally on port {port} with log level {LOG_LEVEL}")
  
    uvicorn.run(app, host="0.0.0.0", port=port) 