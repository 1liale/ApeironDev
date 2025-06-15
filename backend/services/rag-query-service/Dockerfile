# Stage 1: Builder stage
FROM python:3.11-slim AS builder

WORKDIR /app

# Create a non-root user and group
RUN groupadd -r appgroup && useradd --no-log-init -r -g appgroup appuser

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy all necessary Python files for the application
COPY *.py ./
COPY agent/ ./agent/
COPY config.py ./

# Stage 2: Final build
FROM python:3.11-slim

# Create the same non-root user and group as in the builder stage
RUN groupadd -r appgroup && useradd --no-log-init -r -g appgroup appuser

# Copy installed packages from builder stage
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Create app directory and copy application code from builder
WORKDIR /app
COPY --from=builder /app/*.py /app/
COPY --from=builder /app/agent/ /app/agent/

# Secure /app: make it read-only for appuser (owner root, group appgroup r-x)
RUN chown -R root:appgroup /app && \
    chmod -R 550 /app

USER appuser

# Set environment variables for Python
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app:/usr/local/lib/python3.11/site-packages

# Expose the port the app runs on
EXPOSE 8080

# Define the command to run the application
CMD exec uvicorn main:app --host 0.0.0.0 --port 8080 