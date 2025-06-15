from fastapi import FastAPI, Request
import uvicorn
import lancedb
from contextlib import asynccontextmanager
from pydantic import BaseModel
from typing import List

from config import settings
from agent.graph import agent_graph
from agent import dependencies
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_core.messages import HumanMessage
from langgraph.constants import END

# Pydantic model for the query request body
class QueryRequest(BaseModel):
    query: str
    # Later we will add conversation_history and live_buffer_context here

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Handle application startup and shutdown events.
    """
    # Startup: Connect to LanceDB and initialize dependencies
    print("Connecting to LanceDB and initializing resources...")
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
    embedding_model = GoogleGenerativeAIEmbeddings(model=settings.EMBEDDING_MODEL_NAME)
    
    # Store dependencies for the tools to use
    dependencies.db_connection = db_connection
    dependencies.embedding_model = embedding_model

    # Add the compiled agent graph to the app state
    app.state.agent_graph = agent_graph
    print(f"Successfully connected to LanceDB. Available tables: {db_connection.table_names()}")
    yield
    # Shutdown: (No specific action needed for LanceDB connection)
    print("RAG Query Service shutting down.")

app = FastAPI(
    title="RAG Query Service",
    description="Service to handle AI code assistance queries using a RAG pipeline.",
    version="0.1.0",
    lifespan=lifespan,
)

@app.get("/")
def read_root():
    """A simple endpoint to check if the service is running."""
    db_tables = app.state.db.table_names() if hasattr(app.state, 'db') else "Not Connected"
    return {
        "status": "ok",
        "message": "RAG Query Service is running",
        "lancedb_connection": {
            "uri": settings.LANCEDB_URI,
            "tables": db_tables,
        }
    }

@app.post("/query")
async def query_agent(request: Request, body: QueryRequest):
    """
    Main query endpoint to interact with the RAG agent.
    """
    app = request.app
    
    # Initialize the state for the graph
    initial_state = {
        "user_query": body.query,
        "raw_code_snippets": [],
        "raw_web_results": [],
    }
    
    # Invoke the agent graph. We'll stream the results to see the process.
    final_state = None
    async for event in app.state.agent_graph.astream(initial_state):
        # The final state is available at the end of the stream
        if END in event:
            final_state = event[END]

    if not final_state:
        return {"error": "Agent execution failed to complete."}

    # The final summarized context is the response
    return {"response": final_state.get("summarized_context")}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8080, reload=True) 