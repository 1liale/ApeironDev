#!/bin/bash

# Script to test the /execute endpoint of python-worker-service with valid code that reads from stdin

SERVICE_URL="http://localhost:8081/execute"
JOB_ID="curl-valid-stdin-$(date +%s)"

# Valid Python code that reads from stdin and prints it
PYTHON_CODE="import sys; input_content = sys.stdin.read(); print(f'Python script received input: {input_content}')"
INPUT_DATA="Hello from stdin for this specific test!"

echo "Sending valid code (reads stdin) execution request..."

# Use printf to safely construct the JSON payload
JSON_PAYLOAD=$(printf '{
    "job_id": "%s",
    "code": "%s",
    "input_data": "%s"
}' "$JOB_ID" "$PYTHON_CODE" "$INPUT_DATA")

RESPONSE=$(curl -s -X POST "$SERVICE_URL" \
     -H "Content-Type: application/json" \
     -d "$JSON_PAYLOAD")

echo ""
echo "Response: $RESPONSE"