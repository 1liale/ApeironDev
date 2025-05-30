#!/bin/bash

# Script to test the /execute endpoint of python-worker-service with valid code

SERVICE_URL="http://localhost:8081/execute"
JOB_ID="curl-valid-$(date +%s)"

# Valid Python code
# Note: Single quotes within the Python code string are fine here because the overall
# string is double-quoted. When passed to printf %s, they will be treated as literal characters.
PYTHON_CODE="import sys; print('Hello from valid code via curl!'); print('Input was: ' + sys.stdin.read(), file=sys.stderr)"
INPUT_DATA="This is some input data."

echo "Sending valid code execution request..."

# Use printf to safely construct the JSON payload
# The %s for code and input_data will correctly handle most characters.
# For truly complex inputs with newlines or many special chars, a more robust method like using jq to build JSON might be needed.
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