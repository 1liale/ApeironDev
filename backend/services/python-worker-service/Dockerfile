# Stage 1: Builder stage
FROM python:3.11-slim AS builder

WORKDIR /app

# Create a non-root user and group
RUN groupadd -r appgroup && useradd --no-log-init -r -g appgroup appuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY worker.py .

# Stage 2: Final build
FROM python:3.11-slim

WORKDIR /app

# Create the same non-root user and group as in the builder stage
RUN groupadd -r appgroup && useradd --no-log-init -r -g appgroup appuser

# Copy installed packages from builder stage
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Copy application code
COPY --from=builder /app/worker.py .

# Ensure the app directory is owned by the non-root user
# This step helps if you need to write to /app, but we aim for no FS write access for user code.
# For now, the worker itself might need to write logs if not configured to stdout only.
RUN chown -R appuser:appgroup /app
USER appuser

# Set environment variables for Python
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/usr/local/lib/python3.11/site-packages

# Expose the port the app runs on
EXPOSE 8081

# Command to run the application
CMD ["uvicorn", "worker:app", "--host", "0.0.0.0", "--port", "8081"]