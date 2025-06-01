# Stage 1: Builder stage
FROM python:3.11-slim AS builder

WORKDIR /app

# Create a non-root user and group
RUN groupadd -r appgroup && useradd --no-log-init -r -g appgroup appuser

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY worker.py .
COPY models.py .

# Stage 2: Final build
FROM python:3.11-slim

# Create the same non-root user and group as in the builder stage
RUN groupadd -r appgroup && useradd --no-log-init -r -g appgroup appuser

# Copy installed packages from builder stage
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin /usr/local/bin

# Create app directory and copy application code into it
RUN mkdir /app
COPY --from=builder /app/worker.py /app/
COPY --from=builder /app/models.py /app/

# Secure /app: make it read-only for appuser (owner root, group appgroup r-x)
# User code should not write to the application directory.
# Python scripts will be run by appuser, which is part of appgroup.
RUN chown -R root:appgroup /app && \
    chmod -R 550 /app # r-xr-x--- for /app and its contents for root and appgroup

# Create writable /app/tmp directory for appuser for temporary files
# appuser will have rwx permissions here, and no other user will have access.
RUN mkdir /app/tmp && \
    chown appuser:appgroup /app/tmp && \
    chmod 700 /app/tmp # rwx------ for appuser in /app/tmp

WORKDIR /app/tmp

USER appuser

# Set environment variables for Python
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app:/usr/local/lib/python3.11/site-packages

# Expose the port the app runs on
ENV PORT 8080

CMD exec uvicorn worker:app --host 0.0.0.0 --port ${PORT}
