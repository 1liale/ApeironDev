# Dockerfile to build a secure python agent that can execute code
FROM python:3.11-slim-buster
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN chmod 700  /
RUN set -ex \
    # Create a non-root user such that user cannot modify filesystem etc.
    && addgroup --system --gid 1001 appgroup \
    && adduser --system --uid 1001 --gid 1001 --no-create-home appuser \
    # Upgrade the package index and install security upgrades
    && apt-get update \
    && apt-get upgrade -y \
    && apt-get autoremove -y \
    && apt-get clean -y \
    && rm -rf /var/lib/apt/lists/*
EXPOSE 8000

# Set the user to run the application
USER appuser