#!/bin/bash

BASE_URL="http://localhost:8080"

echo "POST /execute..."
JSON_PAYLOAD='{"code":"print(\"Hello, world!\")","language":"python"}'
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST -H "Content-Type: application/json" -d "$JSON_PAYLOAD" $BASE_URL/execute)

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$RESPONSE" | sed '$d')
JOB_ID=$(echo $RESPONSE_BODY | grep -o '"job_id":"[^"]*' | cut -d'"' -f4)

echo "Status Code: $HTTP_CODE"
echo "Response Body: $RESPONSE_BODY"