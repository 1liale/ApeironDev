#!/bin/bash

BASE_URL="https://api-service-628716652336.us-east1.run.app/"

echo "Testing /healthcheck endpoint..."
STATUS_CODE=$(curl -s -o /dev/null -w "%{http_code}" $BASE_URL/healthcheck)
RESPONSE_BODY=$(curl -s $BASE_URL/healthcheck)

echo "Status Code: $STATUS_CODE"
echo "Response Body: $RESPONSE_BODY"