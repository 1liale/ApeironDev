#!/bin/bash

BASE_URL="https://api-service-628716652336.us-east1.run.app/"

# This script assumes a job has been submitted by test_execute.sh or similar means.
# For a standalone test, you might need to submit a job first.

if [ -z "$1" ]; then
  echo "Usage: $0 <job_id>"
  echo "Please provide a job_id to test."
  echo "You can get a job_id by running the test_execute.sh script first."
  exit 1
else
  JOB_ID=$1
fi

echo "GET /result/$JOB_ID..."

RESPONSE=$(curl -s -w "\n%{http_code}" $BASE_URL/result/$JOB_ID)
HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
RESPONSE_BODY=$(echo "$RESPONSE" | sed '$d')

echo "Status Code: $HTTP_CODE"
echo "Response Body: $RESPONSE"