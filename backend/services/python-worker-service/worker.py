import os
import uvicorn
from fastapi import FastAPI

from configs import logger, init_clients, LOG_LEVEL # Import necessary items from configs
from controllers import router as api_router # Import the router from controllers

app = FastAPI(
    title="Python Worker Service",
    description="Handles direct and R2-based code execution for Python.",
    version="0.1.0"
)

@app.on_event("startup")
async def startup_event():
    logger.info("Starting up Python Worker Service...")
    init_clients() # Initialize Firestore and S3 clients from configs.py
    logger.info("Clients initialized (or initialization attempted).")

# Include the API routes
app.include_router(api_router)

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8080))
    # LOG_LEVEL from configs.py is already used for basicConfig, 
    # uvicorn log level can also be set if needed, but often defaults or inherits.
    logger.info(f"Starting Uvicorn server on port {port} with LogLevel: {LOG_LEVEL}")
    uvicorn.run(app, host="0.0.0.0", port=port) 