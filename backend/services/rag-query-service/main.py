import logging
import os
from contextlib import asynccontextmanager
import uvicorn

import google.generativeai as genai
import lancedb
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from agent.graph import agent_graph
from agent import dependencies
from config import settings
from fastapi import FastAPI, Request, HTTPException
from pydantic import BaseModel
from google.cloud import firestore as google_firestore

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

class CloudTaskQueryPayload(BaseModel):
    job_id: str
    user_id: str
    workspace_id: str
    query: str

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan context manager to handle startup and shutdown events.
    """
    # Startup: Initialize Firestore, LanceDB, and Gemini
    try:
        # Validate required environment variables
        required_vars = {
            "GCP_PROJECT_ID": settings.GCP_PROJECT_ID,
            "GOOGLE_API_KEY": settings.GOOGLE_API_KEY,
            "COHERE_API_KEY": settings.COHERE_API_KEY,
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
        
        # Configure Gemini
        genai.configure(api_key=settings.GOOGLE_API_KEY)
        logging.info("Google Generative AI configured successfully")
        
        # Set environment variables for LanceDB S3-compatible storage
        os.environ["AWS_ACCESS_KEY_ID"] = settings.R2_ACCESS_KEY_ID
        os.environ["AWS_SECRET_ACCESS_KEY"] = settings.R2_SECRET_ACCESS_KEY
        os.environ["AWS_ENDPOINT"] = settings.R2_ENDPOINT_URL
        os.environ["AWS_DEFAULT_REGION"] = "auto"
        
        # Initialize LanceDB connection
        db_connection = lancedb.connect(settings.LANCEDB_URI)
        
        # Initialize embedding model
        embedding_model = GoogleGenerativeAIEmbeddings(
            model=settings.EMBEDDING_MODEL_NAME,
            google_api_key=settings.GOOGLE_API_KEY
        )
        
        # Set up dependencies for the agent tools
        dependencies.db_connection = db_connection
        dependencies.embedding_model = embedding_model
        
        logging.info(f"Successfully connected to LanceDB. Available tables: {db_connection.table_names()}")
        
        # Test Gemini connectivity
        model = genai.GenerativeModel(settings.GEMINI_MODEL_NAME)
        test_response = model.generate_content("Hello, this is a test.")
        logging.info(f"Gemini test successful: {test_response.text[:50]}...")
        
        # Set agent graph
        app.state.agent_graph = agent_graph
        logging.info("Agent graph loaded successfully")
        
    except Exception as e:
        logging.error(f"Failed to initialize services: {e}")
        raise
    
    yield  # App runs here
    
    # Shutdown: Clean up resources if needed
    logging.info("Shutting down RAG Query Service")

# Initialize FastAPI app with lifespan
app = FastAPI(
    title="RAG Query Service",
    description="AI-powered query service with codebase and web search capabilities",
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

@app.get("/")
def read_root():
    """
    Root endpoint for health checks.
    """
    return {
        "message": "RAG Query Service is running",
        "version": "1.0.0",
        "status": "healthy"
    }

@app.post("/")
async def handle_cloud_task(request: Request):
    """
    Handle Cloud Tasks payload for async RAG queries.
    """
    try:
        payload_data = await request.json()
        payload = CloudTaskQueryPayload(**payload_data)
        
        logging.info(f"Processing Cloud Task query for job {payload.job_id}")
        
        # Ensure Firestore client is available
        if not get_firestore_client():
            raise HTTPException(status_code=503, detail="Firestore client not available.")
        
        # Update job status to processing
        await update_job_status(payload.job_id, "processing")
        
        # Get agent graph from app state
        agent_graph = request.app.state.agent_graph
        
        # Run the agent with workspace context
        result = agent_graph.invoke({
            "user_query": payload.query,
            "workspace_id": payload.workspace_id,  # Add workspace context
            "raw_code_snippets": [],
            "raw_web_results": [],
            "summarized_context": None,
            "next_action": None,
        })
        
        response_text = result.get("summarized_context", "No response generated")
        
        # Update job status to completed with output
        await update_job_status(payload.job_id, "completed", output=response_text)
        
        logging.info(f"Successfully processed query for job {payload.job_id}")
        
        return {"status": "success", "job_id": payload.job_id}
        
    except Exception as e:
        logging.error(f"Cloud Task processing error: {e}")
        
        # Try to update job status to failed
        try:
            payload_data = await request.json()
            payload = CloudTaskQueryPayload(**payload_data)
            await update_job_status(payload.job_id, "failed", error=str(e))
        except:
            pass  # If we can't even parse the payload, log and continue
            
        raise HTTPException(status_code=500, detail=f"Task processing failed: {str(e)}")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="0.0.0.0", port=port) 