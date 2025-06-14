# Stage 1: Builder stage
FROM python:3.11-slim AS builder

WORKDIR /app

# Create a non-root user and group
RUN groupadd -r appgroup && useradd --no-log-init -r -g appgroup appuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
# Copy all necessary Python files for the application
COPY *.py ./

# Stage 2: Final build
FROM python:3.11-slim

# Create the same non-root user and group as in the builder stage
RUN groupadd -r appgroup && useradd --no-log-init -r -g appgroup appuser

# Copy installed packages from builder stage
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Create app directory and copy application code into it from builder
WORKDIR /app 
COPY --from=builder /app/*.py /app/

# Secure /app: make it read-only for appuser (owner root, group appgroup r-x)
RUN chown -R root:appgroup /app && \
    chmod -R 550 /app # r-xr-x--- for /app and its contents for root and appgroup

USER appuser

# Set environment variables for Python
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app:/usr/local/lib/python3.11/site-packages 
# Note: PYTHONPATH includes /app so imports like `from configs import ...` work

# Expose the port the app runs on
ENV PORT 8080

CMD exec uvicorn worker:app --host 0.0.0.0 --port ${PORT}
