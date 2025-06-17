import logging
import os
from contextlib import asynccontextmanager
from typing import List

import google.generativeai as genai
import lancedb
from config import settings
from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel, Field
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from lancedb.pydantic import LanceModel, Vector
from google.cloud import firestore as google_firestore
import boto3

# Environment Variables
COLLECTION_ID_JOBS = os.getenv("COLLECTION_ID_JOBS", "jobs")

# Global Firestore client
firestore_client: google_firestore.Client | None = None

def get_firestore_client() -> google_firestore.Client | None:
    return firestore_client

def init_firestore_client():
    global firestore_client
    
    if settings.GCP_PROJECT_ID:
        try:
            firestore_client = google_firestore.Client(project=settings.GCP_PROJECT_ID)
            logging.info("Firestore client initialized.")
        except Exception as e:
            logging.error(f"Failed to initialize Firestore client: {e}")
            firestore_client = None
    else:
        logging.error("GCP_PROJECT_ID environment variable not set. Firestore client NOT initialized.")
        firestore_client = None

class CloudTaskIndexPayload(BaseModel):
    """Cloud Tasks payload for indexing."""
    job_id: str
    workspace_id: str
    files: List[str]

class CodeSnippet(LanceModel):
    """Pydantic model for the data we'll store in LanceDB."""
    vector: Vector(settings.EMBEDDING_MODEL_DIM)
    text: str
    file_path: str
    workspace_id: str

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Handle application startup and shutdown events.
    """
    # Startup: Connect to LanceDB and initialize dependencies
    logging.info("Connecting to LanceDB and initializing resources...")
    
    try:
        # Validate required environment variables
        required_vars = {
            "GCP_PROJECT_ID": settings.GCP_PROJECT_ID,
            "GOOGLE_API_KEY": settings.GOOGLE_API_KEY,
            "R2_ACCESS_KEY_ID": settings.R2_ACCESS_KEY_ID,
            "R2_SECRET_ACCESS_KEY": settings.R2_SECRET_ACCESS_KEY,
            "R2_ACCOUNT_ID": settings.R2_ACCOUNT_ID,
            "R2_BUCKET_NAME": settings.R2_BUCKET_NAME,
        }
        
        missing_vars = [var for var, value in required_vars.items() if not value]
        if missing_vars:
            raise ValueError(f"Missing required environment variables: {', '.join(missing_vars)}")
        
        # Initialize Firestore client
        init_firestore_client()
        
        # Configure Google Generative AI
        genai.configure(api_key=settings.GOOGLE_API_KEY)
        
        # Initialize R2/S3 client
        s3_client = boto3.client(
            's3',
            endpoint_url=settings.R2_ENDPOINT_URL,
            aws_access_key_id=settings.R2_ACCESS_KEY_ID,
            aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
            region_name='auto'
        )
        
        # Connect to LanceDB
        storage_options = {
            "aws_access_key_id": settings.R2_ACCESS_KEY_ID,
            "aws_secret_access_key": settings.R2_SECRET_ACCESS_KEY,
            "aws_endpoint_url": settings.R2_ENDPOINT_URL,
            "aws_region": "auto",
        }
        
        db_connection = lancedb.connect(
            settings.LANCEDB_URI,
            storage_options=storage_options
        )
        
        # Initialize embedding model
        embedding_model = GoogleGenerativeAIEmbeddings(
            model=settings.EMBEDDING_MODEL_NAME,
            google_api_key=settings.GOOGLE_API_KEY
        )
        
        # Store in app state
        app.state.db_connection = db_connection
        app.state.embedding_model = embedding_model
        app.state.s3_client = s3_client
        
        logging.info(f"Successfully connected to LanceDB. Available tables: {db_connection.table_names()}")
        
    except Exception as e:
        logging.error(f"Failed to initialize services: {e}")
        raise
    
    yield  # App runs here
    
    # Shutdown
    logging.info("RAG Indexing Service shutting down.")

# Initialize FastAPI app
app = FastAPI(
    title="RAG Indexing Service",
    description="Service to index workspace files for RAG queries",
    version="1.0.0",
    lifespan=lifespan
)

@google_firestore.transactional
def _update_job_in_transaction(transaction: google_firestore.Transaction, job_ref: google_firestore.DocumentReference, update_data: dict):
    transaction.update(job_ref, update_data)

async def update_job_status(job_id: str, status: str, output: str = None, error: str = None):
    """Update job status in Firestore"""
    firestore_client = get_firestore_client()
    if not firestore_client:
        logging.error(f"Job {job_id}: Firestore client not available for status update.")
        raise RuntimeError("Firestore client not available.")
    
    try:
        job_ref = firestore_client.collection(COLLECTION_ID_JOBS).document(job_id)
        update_data = {'status': status}
        
        if output is not None:
            update_data['output'] = output
        if error is not None:
            update_data['error'] = error
            
        transaction = firestore_client.transaction()
        _update_job_in_transaction(transaction, job_ref, update_data)
        logging.info(f"Updated job {job_id} status to {status}")
    except Exception as e:
        logging.error(f"Failed to update job {job_id} status: {e}")
        raise RuntimeError(f"Firestore update failed for job {job_id}") from e

async def process_files_for_indexing(workspace_id: str, file_paths: List[str], app_state):
    """Process files and add them to the vector database"""
    db_connection = app_state.db_connection
    embedding_model = app_state.embedding_model
    s3_client = app_state.s3_client
    
    # Ensure table exists
    table_name = settings.LANCEDB_TABLE_NAME
    if table_name not in db_connection.table_names():
        # Create table with schema
        db_connection.create_table(table_name, schema=CodeSnippet)
        logging.info(f"Created new table: {table_name}")
    
    table = db_connection.open_table(table_name)
    
    indexed_files = []
    
    for file_path in file_paths:
        try:
            # Skip non-code files
            if not any(file_path.endswith(ext) for ext in ['.py', '.js', '.ts', '.jsx', '.tsx', '.go', '.java', '.cpp', '.c', '.rs', '.rb', '.php']):
                logging.info(f"Skipping non-code file: {file_path}")
                continue
                
            # Construct R2 object key (this should match your workspace file structure)
            object_key = f"workspaces/{workspace_id}/files/{file_path}"
            
            # Download file content from R2
            try:
                response = s3_client.get_object(Bucket=settings.R2_BUCKET_NAME, Key=object_key)
                file_content = response['Body'].read().decode('utf-8')
            except Exception as e:
                logging.warning(f"Could not download file {file_path}: {e}")
                continue
            
            # Skip empty files
            if not file_content.strip():
                continue
                
            # Generate embeddings for the file content
            embeddings = embedding_model.embed_documents([file_content])
            
            # Create code snippet record
            code_snippet = CodeSnippet(
                vector=embeddings[0],
                text=file_content,
                file_path=file_path,
                workspace_id=workspace_id
            )
            
            # First, delete existing records for this file
            table.delete(f"file_path = '{file_path}' AND workspace_id = '{workspace_id}'")
            
            # Add new record
            table.add([code_snippet])
            
            indexed_files.append(file_path)
            logging.info(f"Successfully indexed file: {file_path}")
            
        except Exception as e:
            logging.error(f"Error processing file {file_path}: {e}")
            continue
    
    return indexed_files

@app.get("/")
def read_root():
    """Health check endpoint"""
    return {
        "message": "RAG Indexing Service is running",
        "version": "1.0.0",
        "status": "healthy"
    }

@app.post("/")
async def handle_cloud_task(request: Request):
    """
    Handle Cloud Tasks payload for async RAG indexing.
    """
    try:
        payload_data = await request.json()
        payload = CloudTaskIndexPayload(**payload_data)
        
        logging.info(f"Processing Cloud Task indexing for job {payload.job_id}")
        
        # Ensure Firestore client is available
        if not get_firestore_client():
            raise HTTPException(status_code=503, detail="Firestore client not available.")
        
        # Update job status to processing
        await update_job_status(payload.job_id, "processing")
        
        # Process files for indexing
        indexed_files = await process_files_for_indexing(
            payload.workspace_id,
            payload.files,
            request.app.state
        )
        
        # Update job status to completed
        result_message = f"Successfully indexed {len(indexed_files)} files for workspace {payload.workspace_id}"
        await update_job_status(payload.job_id, "completed", output=result_message)
        
        logging.info(f"Successfully processed indexing for job {payload.job_id}")
        
        return {
            "status": "success", 
            "job_id": payload.job_id,
            "indexed_files": len(indexed_files)
        }
        
    except Exception as e:
        logging.error(f"Cloud Task indexing error: {e}")
        
        # Try to update job status to failed
        try:
            payload_data = await request.json()
            payload = CloudTaskIndexPayload(**payload_data)
            await update_job_status(payload.job_id, "failed", error=str(e))
        except:
            pass  # If we can't even parse the payload, log and continue
            
        raise HTTPException(status_code=500, detail=f"Indexing failed: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port) 