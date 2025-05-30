#!/bin/bash

# Script to test the /execute endpoint of python-worker-service with invalid code

SERVICE_URL="http://localhost:8081/execute"
JOB_ID="curl-invalid-$(date +%s)"

# Invalid Python code (will cause a NameError)
PYTHON_CODE="print(undefined_variable)"
INPUT_DATA=""

echo "Sending invalid code execution request..."

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