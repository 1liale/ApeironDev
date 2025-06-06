import os
import logging
import resource
import boto3
from google.cloud import firestore as google_firestore
from botocore.client import BaseClient

# Environment Variables
GCP_PROJECT_ID = os.getenv("GCP_PROJECT_ID")
COLLECTION_ID_JOBS = os.getenv("COLLECTION_ID_JOBS") 
DEFAULT_EXECUTION_TIMEOUT_SEC = int(os.getenv("DEFAULT_EXECUTION_TIMEOUT_SEC", "30"))
LOG_LEVEL = os.getenv("LOG_LEVEL")

# R2/S3 Environment Variables
R2_ACCOUNT_ID = os.getenv('R2_ACCOUNT_ID')
R2_ACCESS_KEY_ID = os.getenv('R2_ACCESS_KEY_ID')
R2_SECRET_ACCESS_KEY = os.getenv('R2_SECRET_ACCESS_KEY')
R2_BUCKET_NAME = os.getenv('R2_BUCKET_NAME')

# Global clients - to be initialized by functions below
firestore_client: google_firestore.Client | None = None
s3_client: BaseClient | None = None  # Use BaseClient for the s3_client type hint

# Configure logging
logging.basicConfig(level=LOG_LEVEL, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def set_execution_limits(cpu_time_sec: int = 10, memory_mb: int = 256, max_processes: int = 1, max_file_size_mb: int = 10):
    try:
        resource.setrlimit(resource.RLIMIT_CPU, (cpu_time_sec, cpu_time_sec))
        resource.setrlimit(resource.RLIMIT_AS, (memory_mb * 1024 * 1024, memory_mb * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NPROC, (max_processes, max_processes))
        resource.setrlimit(resource.RLIMIT_FSIZE, (max_file_size_mb * 1024 * 1024, max_file_size_mb * 1024 * 1024))
    except Exception as e:
        logger.warning(f"Failed to set some resource limits (expected on some platforms): {e}")

def get_firestore_client() -> google_firestore.Client | None:
    return firestore_client

def get_s3_client() -> BaseClient | None:  # Use BaseClient for the return type hint
    return s3_client

def init_clients():
    global firestore_client, s3_client

    # Initialize Firestore
    if GCP_PROJECT_ID:
        try:
            firestore_client = google_firestore.Client(project=GCP_PROJECT_ID)
            logger.info("Firestore client initialized.")
        except Exception as e:
            logger.critical(f"Failed to initialize Firestore client: {e}", exc_info=True)
            firestore_client = None # Ensure it's None on failure
    else:
        logger.critical("GCP_PROJECT_ID environment variable not set. Firestore client NOT initialized.")
        firestore_client = None

    # Initialize S3 client for R2
    if R2_ACCOUNT_ID and R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY:
        try:
            endpoint_url = f"https://{R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

            s3_client = boto3.client(
                's3',
                endpoint_url=endpoint_url,
                aws_access_key_id=R2_ACCESS_KEY_ID,
                aws_secret_access_key=R2_SECRET_ACCESS_KEY,
                region_name="auto",
                config=boto3.session.Config(
                    signature_version='s3v4',
                    s3={'addressing_style': 'path'}
                )
            )
            logger.info("Boto3 S3 client for R2 initialized.")
        except Exception as e:
            logger.critical(f"Failed to initialize Boto3 S3 client: {e}", exc_info=True)
            s3_client = None # Ensure it's None on failure
    else:
        logger.warning("R2/S3 client environment variables not fully set. R2 client NOT initialized.")
        s3_client = None

# Perform initial checks on import
if not GCP_PROJECT_ID:
    logger.warning("GCP_PROJECT_ID not set at import time.") # Log warning early
if not all([R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY]):
    logger.warning("R2 client env vars not fully set at import time.") # Log warning early 