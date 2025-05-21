import subprocess
import json
import os
import time
import datetime
from google.cloud import pubsub_v1
from google.cloud import datastore

# --- Worker Configuration ---
# TODO: Replace 'your-gcp-project' and 'your-subscription-id' with your actual project and subscription IDs
PROJECT_ID = os.getenv("GOOGLE_CLOUD_PROJECT", "your-gcp-project")
SUBSCRIPTION_ID = "code-execution-requests-sub" # Ensure this subscription is for the TOPIC_ID in main.py

KIND_EXEC_RESULT = "ExecResult"

datastore_client = None
subscriber = None
subscription_path = None

try:
    datastore_client = datastore.Client(project=PROJECT_ID)
    subscriber = pubsub_v1.SubscriberClient()
    subscription_path = subscriber.subscription_path(PROJECT_ID, SUBSCRIPTION_ID)
except Exception as e:
    print(f"Failed to initialize Google Cloud clients: {e}")
    # Worker cannot operate without these, so allow it to exit or be restarted by supervisor.
    raise

class CodeExecutionResult(dict):
    def __init__(self, result: str, status: int):
        super().__init__(result=result, status=status)

def execute_code(code: str, stdin_args: list[str]) -> CodeExecutionResult:
    """
    Executes the given Python code with the provided stdin arguments.
    Returns a dictionary containing the result and status.
    """
    try:
        # Ensure stdin_args are all strings if they are not empty
        processed_stdin_args = [str(arg) for arg in stdin_args if arg is not None]
        
        result = subprocess.check_output(
            ['python3', '-c', code] + processed_stdin_args,
            text=True,
            timeout=30, # Increased timeout for potentially longer worker tasks
            stderr=subprocess.STDOUT
        )
        return CodeExecutionResult(result=result, status=0)
    except Exception as e:
        status_code = 3 
        error_message = f"An unexpected error occurred: {str(e)}"
        if isinstance(e, subprocess.CalledProcessError):
            status_code = 1
            error_message = str(e.output)
        elif isinstance(e, subprocess.TimeoutExpired):
            status_code = 2
            error_message = "Code execution timed out after 30 seconds."
        return CodeExecutionResult(result=error_message, status=status_code) 

def save_to_datastore(code_payload: dict, output: CodeExecutionResult):
    if not code_payload.get('isSubmit', False) or output['status'] != 0:
        print(f"Submission not saved. isSubmit: {code_payload.get('isSubmit')}, Status: {output['status']}")
        return
    if not datastore_client:
        print("Datastore client not initialized. Cannot save.")
        return
    try:
        key = datastore_client.key(KIND_EXEC_RESULT)
        entity = datastore.Entity(key=key)
        entity.update({
            'src': code_payload['code'],
            'stdin': code_payload.get('stdin', ""),
            'res': output['result'],
            'timestamp': datetime.datetime.now(datetime.UTC),
            'status': output['status'] # Also save the status
        })
        datastore_client.put(entity)
        print(f"Successfully saved execution result to Datastore: {entity.key}")
    except Exception as e:
        print(f"Error saving to Datastore: {e}")

def process_message(message):
    """Callback function to process a single Pub/Sub message."""
    try:
        print(f"Received message ID: {message.message_id}")
        data_str = message.data.decode("utf-8")
        payload = json.loads(data_str)
        
        code_to_run = payload.get('code')
        stdin_str = payload.get('stdin')
        stdin_args = stdin_str.split() if stdin_str else []

        if not code_to_run:
            print("Error: 'code' not found in message payload.")
            message.nack() # Negative acknowledgement
            return

        print(f"Executing code: {code_to_run[:100]}...")
        execution_output = execute_code(code_to_run, stdin_args)
        print(f"Execution result: Status {execution_output['status']}, Output: {execution_output['result'][:100]}...")
        
        save_to_datastore(payload, execution_output)
        
        message.ack() # Acknowledge the message after successful processing
        print(f"Successfully processed and acknowledged message ID: {message.message_id}")

    except json.JSONDecodeError as e:
        print(f"Error decoding JSON from message data: {e}")
        message.nack()
    except Exception as e:
        print(f"An error occurred while processing message ID {message.message_id}: {e}")
        message.nack() # Nack the message so Pub/Sub can retry or dead-letter it

def main():
    if not subscriber or not subscription_path:
        print("Pub/Sub subscriber not initialized. Worker cannot start.")
        return

    if PROJECT_ID == "your-gcp-project":
        print("Warning: GOOGLE_CLOUD_PROJECT is not set or default is used.")

    print(f"Listening for messages on {subscription_path}...")
    flow_control = pubsub_v1.types.FlowControl(max_messages=10)
    streaming_pull_future = subscriber.subscribe(
        subscription_path, 
        callback=process_message,
        flow_control=flow_control
    )
    try:
        streaming_pull_future.result() # Block until an unrecoverable error or the future is cancelled.
    except Exception as e:
        print(f"Worker stopped due to an unrecoverable error: {e}")
        # At this point, the supervisor process should handle restarting the worker.
        # For example, Docker would restart the container based on its restart policy.

if __name__ == "__main__":
    main() 