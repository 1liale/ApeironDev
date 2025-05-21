# Stage 1: Builder - Installs Python dependencies
FROM python:3.11-slim-bookworm AS builder

# Install system dependencies for Python package compilation
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .

# Install Python packages
RUN pip install --no-cache-dir -r requirements.txt

# Stage 2: Runner - Creates the final runtime image
FROM python:3.11-slim-bookworm

# Create a non-root user
RUN set -ex \
    && addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --gid 1001 --no-create-home appuser \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy installed Python packages from builder stage
COPY --from=builder /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=builder /usr/local/bin/ /usr/local/bin/

# Copy all application code (both API and worker)
COPY . .

# Set permissions for application directory
RUN chown -R appuser:appgroup /app \
    && chmod -R 755 /app

# Expose the port for the API (if this instance runs as API)
EXPOSE 8000

# Set user to run the application
USER appuser