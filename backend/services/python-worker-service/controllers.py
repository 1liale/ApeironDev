import subprocess
from datetime import datetime, timezone  # UTC timezone for ISO 8601 standardization
from time_utils import now_iso8601  # Standardized ISO 8601 formatting
from pathlib import Path
import tempfile # Added for TemporaryDirectory

from fastapi import APIRouter, HTTPException # Using APIRouter for modularity
from google.cloud import firestore as google_firestore # For type hinting

from models import CloudTaskPayload, CloudTaskAuthPayload
from configs import (
    logger, 
    get_firestore_client, 
    get_s3_client, 
    set_execution_limits,
    COLLECTION_ID_JOBS, 
    DEFAULT_EXECUTION_TIMEOUT_SEC
)

router = APIRouter()

def _execute_python_code_direct(job_id: str, code: str, input_data: str | None) -> tuple[str | None, str | None, int]:
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
            logger.warning(f"Job {job_id} (direct): User code error (rc={process.returncode}).")
            return process.stdout, error_output, 1 
    except subprocess.TimeoutExpired:
        logger.warning(f"Job {job_id} (direct): Code execution timed out.")
        return None, f"Execution timed out after {DEFAULT_EXECUTION_TIMEOUT_SEC} seconds.", 2
    except Exception as e:
        logger.error(f"Job {job_id} (direct): Internal error: {e}", exc_info=True)
        return None, f"Internal worker error: {str(e)}", 3

def _execute_python_script_in_dir(job_id: str, script_path: Path, exec_dir: Path, input_data: str | None) -> tuple[str | None, str | None, int]:
    try:
        logger.info(f"Job {job_id}: Executing 'python3 {str(script_path)}' in '{exec_dir}'")
        process = subprocess.run(
            ['python3', str(script_path)],
            text=True, 
            timeout=DEFAULT_EXECUTION_TIMEOUT_SEC, 
            capture_output=True,
            cwd=str(exec_dir),
            input=input_data,
            preexec_fn=set_execution_limits 
        )
        if process.returncode == 0:
            return process.stdout, None, 0
        else:
            error_output = process.stderr if process.stderr else process.stdout
            logger.warning(f"Job {job_id} (workspace): User code error (rc={process.returncode}).")
            return process.stdout, error_output, 1
    except subprocess.TimeoutExpired:
        logger.warning(f"Job {job_id} (workspace): Code execution timed out.")
        return None, f"Execution timed out after {DEFAULT_EXECUTION_TIMEOUT_SEC} seconds.", 2
    except Exception as e:
        logger.error(f"Job {job_id} (workspace): Internal error: {e}", exc_info=True)
        return None, f"Internal worker error: {str(e)}", 3

@google_firestore.transactional
def _update_job_in_transaction(transaction: google_firestore.Transaction, job_ref: google_firestore.DocumentReference, update_data: dict):
    transaction.update(job_ref, update_data)

def _update_firestore_job_status(job_id: str, job_doc_ref: google_firestore.DocumentReference, data_to_update: dict, stage_description: str):
    firestore_client = get_firestore_client()
    if not firestore_client:
        logger.error(f"Job {job_id}: Firestore client N/A for '{stage_description}'.")
        raise RuntimeError("Firestore client not available.")
    try:
        transaction = firestore_client.transaction()
        _update_job_in_transaction(transaction, job_doc_ref, data_to_update)
        logger.info(f"Job {job_id}: Firestore updated for '{stage_description}'. Status: {data_to_update.get('status')}")
    except Exception as e:
        logger.error(f"Job {job_id}: Firestore update FAILED for '{stage_description}': {e}", exc_info=True)
        raise RuntimeError(f"Firestore update failed for job {job_id}") from e

def _build_final_update_data(exec_status_code: int, output: str | None, error_details: str | None, current_status: str) -> dict:
    # Generate standardized ISO 8601 timestamp matching JavaScript toISOString()
    completed_at_time = now_iso8601()  # Exact JavaScript toISOString() format
    data = {"updated_at": completed_at_time}
    
    if current_status.startswith("processing"):
         data["processing_started_at"] = completed_at_time 

    if exec_status_code == 0: 
        data["status"] = "completed"
        data["output"] = output or ""
        data["error"] = None
    else: 
        data["status"] = "failed"
        data["error"] = error_details or "Unknown error"
        data["output"] = output or ""
    
    if exec_status_code == 2: data["failure_type"] = "timeout"
    elif exec_status_code == 1: data["failure_type"] = "user_code_error"
    elif exec_status_code == 3: data["failure_type"] = "worker_internal_error"
    
    data["completed_at"] = completed_at_time
    return data

@router.post("/execute")
async def execute_direct_task(payload: CloudTaskPayload):
    job_id = payload.job_id
    logger.info(f"Job {job_id}: /execute. Lang: {payload.language}, Input: {len(payload.input or '')} chars.")
    firestore_client = get_firestore_client()
    if not firestore_client:
        raise HTTPException(status_code=503, detail="Cannot connect to Firestore.")

    job_doc_ref = firestore_client.collection(COLLECTION_ID_JOBS).document(job_id)
    initial_status = "processing_direct"
    try:
        _update_firestore_job_status(job_id, job_doc_ref, {"status": initial_status, "updated_at": now_iso8601()}, "initial status")
    except RuntimeError:
        raise HTTPException(status_code=500, detail=f"Failed to set initial status for job {job_id}.")

    output, error_details, exec_status_code = _execute_python_code_direct(job_id, payload.code, payload.input)
    final_job_data = _build_final_update_data(exec_status_code, output, error_details, initial_status)

    try:
        _update_firestore_job_status(job_id, job_doc_ref, final_job_data, "final results")
    except RuntimeError:
        logger.critical(f"Job {job_id}: CRITICAL - FAILED TO SAVE FINAL RESULTS after execution.")
        pass 

    logger.info(f"Job {job_id}: Direct exec completed. Status: {final_job_data.get('status')}.")
    return {"job_id": job_id, "message": "Direct execution task processed."}

@router.post("/execute_auth")
async def execute_auth_task(payload: CloudTaskAuthPayload):
    job_id = payload.job_id
    logger.info(f"Job {job_id}: /execute_auth. WS: {payload.workspace_id}, Entry: {payload.entrypoint_file}")
    firestore_client = get_firestore_client()
    s3_client = get_s3_client()

    # Ensure essential clients are available
    if not firestore_client or not s3_client:
        detail_msg = []
        if not firestore_client: detail_msg.append("Firestore unavailable")
        if not s3_client: detail_msg.append("R2 unavailable")
        raise HTTPException(status_code=503, detail=f"Service temporarily unavailable ({', '.join(detail_msg)}).")

    job_doc_ref = firestore_client.collection(COLLECTION_ID_JOBS).document(job_id)
    initial_status = "processing_auth_workspace"
    try:
        # Set initial job status in Firestore
        _update_firestore_job_status(job_id, job_doc_ref, {"status": initial_status, "updated_at": now_iso8601()}, "initial status")
    except RuntimeError:
        raise HTTPException(status_code=500, detail=f"Failed to set initial status for job {job_id}.")

    try:
        # Create a temporary directory for workspace files, ensuring cleanup
        with tempfile.TemporaryDirectory(prefix=f"job_{job_id}_") as temp_dir_name: 
            workspace_exec_dir = Path(temp_dir_name)
            logger.info(f"Job {job_id}: Created temporary execution directory: {workspace_exec_dir}")
            _update_firestore_job_status(job_id, job_doc_ref, {"status": "fetching_from_r2", "updated_at": now_iso8601()}, "fetching code")

            if not payload.files:
                msg = "No files found in job payload manifest to download."
                logger.error(f"Job {job_id}: {msg}")
                final_job_data = _build_final_update_data(3, None, msg, initial_status)
                _update_firestore_job_status(job_id, job_doc_ref, final_job_data, "final results - no files")
                return {"job_id": job_id, "message": msg, "final_status": "failed"}
            
            logger.info(f"Job {job_id}: Found {len(payload.files)} files in manifest. Starting download from R2.")

            # Download each file from the manifest provided in the payload
            for file_to_download in payload.files:
                s3_key = file_to_download.r2_object_key
                relative_path = file_to_download.file_path
                
                if not s3_key or not relative_path:
                    logger.warning(f"Job {job_id}: Skipping file in manifest with missing key or path. Key: '{s3_key}', Path: '{relative_path}'")
                    continue

                local_file = workspace_exec_dir / relative_path
                local_file.parent.mkdir(parents=True, exist_ok=True)
                logger.info(f"Job {job_id}:   Downloading '{s3_key}' to '{local_file}'")
                s3_client.download_file(payload.r2_bucket_name, s3_key, str(local_file))
            
            entrypoint_script_local_path = workspace_exec_dir / payload.entrypoint_file.lstrip('/')
            logger.info(f"Job {job_id}: Checking for entrypoint at resolved path: {entrypoint_script_local_path}")
            
            # Verify the specified entrypoint file exists locally after download
            if not entrypoint_script_local_path.is_file():
                msg = f"Entrypoint '{payload.entrypoint_file}' not found in downloaded workspace. Checked path: {entrypoint_script_local_path}"
                logger.error(f"Job {job_id}: {msg}")
                final_job_data = _build_final_update_data(3, None, msg, initial_status)
                _update_firestore_job_status(job_id, job_doc_ref, final_job_data, "final results - entrypoint missing")
                return {"job_id": job_id, "message": msg, "final_status": "failed"}

            # Update Firestore status before running the code
            _update_firestore_job_status(job_id, job_doc_ref, {"status": "running_auth_workspace", "updated_at": now_iso8601()}, "running code")
            
            # Execute the Python script from the temporary directory
            output, error_details, exec_status_code = _execute_python_script_in_dir(
                job_id, Path(payload.entrypoint_file), workspace_exec_dir, payload.input 
            )
            # Update Firestore with final execution results
            final_job_data = _build_final_update_data(exec_status_code, output, error_details, initial_status)
            _update_firestore_job_status(job_id, job_doc_ref, final_job_data, "final results")
            
            logger.info(f"Job {job_id}: Auth Workspace execution completed. Status: {final_job_data.get('status')}.")
            return {"job_id": job_id, "message": "Auth workspace execution task processed."}

    except Exception as e: # Catch-all for outer try, including TemporaryDirectory issues or R2 download
        logger.error(f"Job {job_id}: Unhandled exception in /execute_auth: {e}", exc_info=True)
        try:
            # Attempt to update Firestore with an error status on unhandled exceptions
            final_job_data = _build_final_update_data(3, None, f"Unhandled worker exception: {str(e)}", initial_status)
            _update_firestore_job_status(job_id, job_doc_ref, final_job_data, "final results - unhandled exception")
        except Exception as firestore_e:
            # Log critical failure if Firestore update fails after an unhandled exception
            logger.critical(f"Job {job_id}: CRITICAL - FAILED TO UPDATE Firestore after unhandled exception: {firestore_e}")
        raise HTTPException(status_code=500, detail=f"Internal error processing job {job_id}.")

@router.get("/")
async def health_check_endpoint():
    logger.info("Health check / called.")
    return {"status": "Python Worker Service is running (FastAPI)"}