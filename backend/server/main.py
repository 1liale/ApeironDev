import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware
from google.cloud import pubsub_v1
import json
import os

app = FastAPI()

PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "your-gcp-project")
TOPIC_ID = "code-execution-requests"

try:
    publisher = pubsub_v1.PublisherClient()
    topic_path = publisher.topic_path(PROJECT_ID, TOPIC_ID)
except Exception as e:
    print(f"Failed to initialize Pub/Sub publisher: {e}")
    publisher = None
    topic_path = None

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class CodeInput(BaseModel):
    code: str
    stdin: str | None = None
    isSubmit: bool = False

class APIResponse(BaseModel):
    message: str
    data: dict | None = None

@app.post("/runcode", response_model=APIResponse)
async def request_code_execution(code_input: CodeInput):
    if not publisher or not topic_path:
        raise HTTPException(status_code=503, detail="Pub/Sub service is not available.")
    try:
        message_data = code_input.model_dump_json().encode("utf-8")
        future = publisher.publish(topic_path, message_data)
        message_id = future.result()
        return {"message": "Code execution request published successfully", "data": {"message_id": message_id}}
    except Exception as e:
        print(f"Error publishing to Pub/Sub: {e}")
        raise HTTPException(status_code=500, detail="Failed to publish code execution request.")

@app.get("/health")
async def health_check():
    if publisher and topic_path:
        return {"status": "API is healthy, Pub/Sub publisher initialized"}
    else:
        return {"status": "API is unhealthy, Pub/Sub publisher failed to initialize"}

if __name__ == "__main__":
    if PROJECT_ID == "your-gcp-project" and publisher is None:
        print("Warning: GOOGLE_CLOUD_PROJECT is not set correctly or Pub/Sub initialization failed.")
    uvicorn.run(app, host="0.0.0.0", port=8000)
