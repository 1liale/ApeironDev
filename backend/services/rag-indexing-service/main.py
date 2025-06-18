import json
import logging
import os
from typing import List, Dict, Any
from contextlib import asynccontextmanager

import boto3
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import lancedb
import google.generativeai as genai
from botocore.exceptions import ClientError

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Configuration with defaults
class Config:
    gcp_project_id: str = ""
    gcp_region: str = ""
    lancedb_table_name: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_account_id: str = ""
    r2_bucket_name: str = ""
    google_api_key: str = ""

config = Config()

# Global clients
r2_client = None
lance_db = None
lance_table = None

def load_config():
    """Load configuration from environment variables."""
    config.gcp_project_id = os.getenv("GCP_PROJECT_ID", "")
    config.gcp_region = os.getenv("GCP_REGION", "")
    config.lancedb_table_name = os.getenv("LANCEDB_TABLE_NAME", "")
    config.r2_access_key_id = os.getenv("R2_ACCESS_KEY_ID", "")
    config.r2_secret_access_key = os.getenv("R2_SECRET_ACCESS_KEY", "")
    config.r2_account_id = os.getenv("R2_ACCOUNT_ID", "")
    config.r2_bucket_name = os.getenv("R2_BUCKET_NAME", "")
    config.google_api_key = os.getenv("GOOGLE_API_KEY", "")

def validate_config():
    """Validate that all required configuration is present."""
    required_vars = [
        ("GCP_PROJECT_ID", config.gcp_project_id),
        ("GCP_REGION", config.gcp_region),
        ("LANCEDB_TABLE_NAME", config.lancedb_table_name),
        ("R2_ACCESS_KEY_ID", config.r2_access_key_id),
        ("R2_SECRET_ACCESS_KEY", config.r2_secret_access_key),
        ("R2_ACCOUNT_ID", config.r2_account_id),
        ("R2_BUCKET_NAME", config.r2_bucket_name),
        ("GOOGLE_API_KEY", config.google_api_key),
    ]
    
    missing_vars = [name for name, value in required_vars if not value]
    if missing_vars:
        raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")

def init_r2_client():
    """Initialize R2 client."""
    global r2_client
    r2_client = boto3.client(
        's3',
        endpoint_url=f'https://{config.r2_account_id}.r2.cloudflarestorage.com',
        aws_access_key_id=config.r2_access_key_id,
        aws_secret_access_key=config.r2_secret_access_key,
        region_name='auto'
    )
    logger.info("R2 client initialized")

def init_lancedb():
    """Initialize LanceDB connection and guarantee that the **native full-text
    search (FTS)** index exists on the `content` column.
    """
    global lance_db, lance_table
    
    # Set environment variables for LanceDB S3-compatible storage
    os.environ["AWS_ACCESS_KEY_ID"] = config.r2_access_key_id
    os.environ["AWS_SECRET_ACCESS_KEY"] = config.r2_secret_access_key
    os.environ["AWS_ENDPOINT"] = f"https://{config.r2_account_id}.r2.cloudflarestorage.com"
    os.environ["AWS_DEFAULT_REGION"] = "auto"
    
    lancedb_uri = f"s3://{config.r2_bucket_name}"
    lance_db = lancedb.connect(lancedb_uri)
    
    # Create table if it doesn't exist
    try:
        lance_table = lance_db.open_table(config.lancedb_table_name)
        logger.info(f"Opened existing LanceDB table: {config.lancedb_table_name}")

        # Ensure there is a full-text (inverted) index on the 'content' column for keyword search
        try:
            lance_table.create_fts_index("content")  # no-op if index already exists
            logger.info("Verified/created FTS index on 'content' column")
        except Exception as e:
            # If the index already exists or another benign error occurs, just log it
            logger.warning(f"FTS index creation skipped or failed: {e}")
    except (FileNotFoundError, ValueError):
        import pyarrow as pa
        schema = pa.schema([
            pa.field("file_path", pa.string()),
            pa.field("content", pa.string()),
            pa.field("workspace_id", pa.string()),
            pa.field("vector", pa.list_(pa.float32(), 768))  # Gemini embedding dimension
        ])
        lance_table = lance_db.create_table(config.lancedb_table_name, schema=schema)
        logger.info(f"Created new LanceDB table: {config.lancedb_table_name}")

        # Ensure there is a full-text (inverted) index on the 'content' column for keyword search
        try:
            lance_table.create_fts_index("content")  # no-op if index already exists
            logger.info("Verified/created FTS index on 'content' column")
        except Exception as e:
            # If the index already exists or another benign error occurs, just log it
            logger.warning(f"FTS index creation skipped or failed: {e}")

def init_genai():
    """Initialize Google Generative AI."""
    genai.configure(api_key=config.google_api_key)
    logger.info("Google Generative AI initialized")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan context manager."""
    logger.info("Starting RAG Indexing Service...")
    
    # Load and validate configuration
    load_config()
    validate_config()
    
    # Initialize clients
    init_r2_client()
    init_lancedb()
    init_genai()
    
    logger.info("RAG Indexing Service startup complete")
    yield
    logger.info("RAG Indexing Service shutting down...")

app = FastAPI(title="RAG Indexing Service", lifespan=lifespan)

class WorkerFile(BaseModel):
    r2_object_key: str
    file_path: str

class RagIndexingRequest(BaseModel):
    job_id: str
    workspace_id: str
    files: List[WorkerFile]

def get_embedding(text: str) -> List[float]:
    """Generate embedding for text using Google Generative AI."""
    try:
        result = genai.embed_content(
            model="models/text-embedding-004",
            content=text,
            task_type="retrieval_document"
        )
        return result['embedding']
    except Exception as e:
        logger.error(f"Failed to generate embedding: {e}")
        raise

def download_file_from_r2(r2_object_key: str, file_path: str) -> str:
    """Download file content from R2."""
    try:
        logger.info(f"Attempting to download file {file_path} with R2 key: {r2_object_key}")
        response = r2_client.get_object(Bucket=config.r2_bucket_name, Key=r2_object_key)
        content = response['Body'].read().decode('utf-8')
        logger.info(f"Successfully downloaded file {file_path} ({len(content)} bytes)")
        return content
    except ClientError as e:
        logger.error(f"Failed to download file {file_path} from R2 with key '{r2_object_key}': {e}")
        raise
    except UnicodeDecodeError as e:
        logger.warning(f"Failed to decode file {file_path} as UTF-8, skipping: {e}")
        return ""

def index_files(workspace_id: str, files: List[WorkerFile]) -> Dict[str, Any]:
    """Index files in the vector database."""
    indexed_count = 0
    skipped_count = 0
    errors = []
    
    for file_info in files:
        try:
            # Download file content using the R2 object key
            content = download_file_from_r2(file_info.r2_object_key, file_info.file_path)
            
            if not content.strip():
                logger.warning(f"Skipping empty file: {file_info.file_path}")
                skipped_count += 1
                continue
            
            # Generate embedding
            embedding = get_embedding(content)
            
            # Delete existing records for this file
            try:
                lance_table.delete(f"workspace_id = '{workspace_id}' AND file_path = '{file_info.file_path}'")
            except Exception as e:
                logger.warning(f"No existing records to delete for {file_info.file_path}: {e}")
            
            # Insert new record
            data = [{
                "file_path": file_info.file_path,
                "content": content,
                "workspace_id": workspace_id,
                "vector": embedding
            }]
            lance_table.add(data)
            
            indexed_count += 1
            logger.info(f"Successfully indexed file: {file_info.file_path}")
            
        except Exception as e:
            error_msg = f"Failed to index file {file_info.file_path}: {str(e)}"
            logger.error(error_msg)
            errors.append(error_msg)
    
    return {
        "indexed_count": indexed_count,
        "skipped_count": skipped_count,
        "error_count": len(errors),
        "errors": errors
    }

@app.post("/")
async def handle_indexing_task(request: RagIndexingRequest):
    """Handle RAG indexing task from Cloud Tasks."""
    logger.info(f"Processing RAG indexing task for job {request.job_id}, workspace {request.workspace_id}")
    
    try:
        result = index_files(request.workspace_id, request.files)
        
        logger.info(f"RAG indexing completed for job {request.job_id}: {result}")
        
        return {
            "success": True,
            "job_id": request.job_id,
            "result": result
        }
        
    except Exception as e:
        error_msg = f"RAG indexing failed for job {request.job_id}: {str(e)}"
        logger.error(error_msg)
        
        raise HTTPException(status_code=500, detail=error_msg)

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8080) 