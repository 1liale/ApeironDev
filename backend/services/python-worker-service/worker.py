import subprocess
import os
import resource
import logging
import uvicorn
from datetime import datetime, timedelta, timezone

from fastapi import FastAPI, HTTPException, Request
from google.cloud import firestore
from google.cloud.firestore import DocumentReference
from models import CloudTaskPayload

# Environment Variables
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID")
COLLECTION_ID_JOBS = os.getenv("COLLECTION_ID_JOBS", "Job")
DEFAULT_EXECUTION_TIMEOUT_SEC = int(os.getenv("DEFAULT_EXECUTION_TIMEOUT_SEC", "10"))
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()

app = FastAPI()
firestore_client: firestore.Client | None = None

logging.basicConfig(level=LOG_LEVEL, format='%(asctime)s - %(levelname)s - %(message)s') # Simplified format
logger = logging.getLogger(__name__)

if not GCP_PROJECT_ID:
    logger.critical("GCP_PROJECT_ID environment variable not set. Firestore client cannot be initialized.")

@app.on_event("startup")
async def startup_event():
    global firestore_client
    if GCP_PROJECT_ID:
        try:
            firestore_client = firestore.Client(project=GCP_PROJECT_ID)
        except Exception as e:
            logger.critical(f"Failed to initialize Firestore client: {e}", exc_info=True)

def set_execution_limits(
    cpu_time_sec: int = 5,
    memory_mb: int = 256,
    max_processes: int = 1,
    max_file_size_mb: int = 10,
):
    """Sets resource limits for the child process."""
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_time_sec, cpu_time_sec))
        resource.setrlimit(resource.RLIMIT_AS, (memory_mb * 1024 * 1024, memory_mb * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NPROC, (max_processes, max_processes))
        resource.setrlimit(resource.RLIMIT_FSIZE, (max_file_size_mb * 1024 * 1024, max_file_size_mb * 1024 * 1024))
    except Exception as e:
        logger.warning(f"Failed to set resource limits: {e}. This might be expected on some platforms.")

def execute_python_code(job_id: str, code: str, input_data: str) -> tuple[str | None, str | None, int]:
    """Executes python code. Returns: (output, error_details, status_code: 0=success, 1=user_err, 2=timeout, 3=internal_err)."""
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
            logger.warning(f"Job {job_id}: User code error (rc={process.returncode}). Error: {error_output[:300]}...")
            return None, error_output, 1
    except subprocess.TimeoutExpired:
        logger.warning(f"Job {job_id}: Code execution timed out after {DEFAULT_EXECUTION_TIMEOUT_SEC}s.")
        return None, f"Execution timed out after {DEFAULT_EXECUTION_TIMEOUT_SEC} seconds.", 2
    except Exception as e:
        logger.error(f"Job {job_id}: Internal error during code execution: {e}", exc_info=LOG_LEVEL=="DEBUG")
        return None, f"Internal worker error during execution: {str(e)}", 3

@firestore.transactional
def _update_job_in_transaction(transaction: firestore.Transaction, job_ref: DocumentReference, update_data: dict):
    transaction.update(job_ref, update_data)

def update_firestore_document(job_id: str, job_doc_ref: DocumentReference, data_to_update: dict, stage_description: str):
    """Updates a Firestore document transactionally, logs errors, and re-raises on failure."""
    global firestore_client
    if not firestore_client:
        logger.error(f"Job {job_id}: Firestore client unavailable for {stage_description}.")
        raise RuntimeError("Firestore client not available.")

    try:
        transaction = firestore_client.transaction()
        _update_job_in_transaction(transaction, job_doc_ref, data_to_update)
    except Exception as e:
        logger.error(f"Job {job_id}: FAILED to update Firestore for {stage_description}: {e}", exc_info=True)
        raise RuntimeError(f"Firestore update failed for {stage_description} (job {job_id})") from e

def build_final_update_data(exec_status_code: int, output: str | None, error_details: str | None) -> dict:
    """Constructs data for the final Firestore update."""
    completed_at_time = datetime.now(timezone.utc)
    expires_at_time = completed_at_time + timedelta(days=15)
    data = {
        "completed_at": completed_at_time,
        "expires_at": expires_at_time,
    }
    if exec_status_code == 0:
        data["status"] = "completed"
        data["output"] = output or ""
        data["error"] = None
    else:
        data["status"] = "failed"
        data["error"] = error_details or "Unknown error"
        data["output"] = output or ""
    return data

@app.post("/execute")
async def execute_task_endpoint(payload: CloudTaskPayload, request: Request):
    job_id = payload.job_id
    logger.info(f"Job {job_id}: Processing request. Lang: {payload.language}, Input: {len(payload.input or "")} chars.")

    global firestore_client
    if not firestore_client:
        logger.error(f"Job {job_id}: Firestore client not available.")
        raise HTTPException(status_code=503, detail="Worker service unavailable: Firestore not configured.")

    job_doc_ref = firestore_client.collection(COLLECTION_ID_JOBS).document(job_id)

    processing_update_data = {
        "status": "processing",
        "processing_started_at": datetime.now(timezone.utc)
    }
    try:
        update_firestore_document(job_id, job_doc_ref, processing_update_data, "processing status")
    except RuntimeError as e:
        raise HTTPException(status_code=500, detail=str(e))

    if payload.language.lower() != "python":
        logger.warning(f"Job {job_id}: Language '{payload.language}' specified; worker executes as Python.")

    output, error_details, exec_status_code = execute_python_code(job_id, payload.code, payload.input or "")
    final_job_data = build_final_update_data(exec_status_code, output, error_details)

    try:
        update_firestore_document(job_id, job_doc_ref, final_job_data, "final results")
    except RuntimeError as e:
        logger.critical(f"Job {job_id}: FAILED TO SAVE FINAL RESULTS to Firestore. Error: {e}")
        raise HTTPException(status_code=500, detail=f"Critical error saving final results for job {job_id}.")

    logger.info(f"Job {job_id}: Processing completed. Final status: {final_job_data.get('status')}.")
    return {"job_id": job_id, "message": "Execution task processed."}

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    logger.info(f"Starting Python worker service on port {port}, LogLevel: {LOG_LEVEL}")
    uvicorn.run(app, host="0.0.0.0", port=port) 