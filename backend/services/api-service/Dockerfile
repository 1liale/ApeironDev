FROM golang:1.23-alpine AS builder

WORKDIR /app

# Copy go.mod and go.sum files to download dependencies
COPY go.mod go.sum ./
RUN go mod download

# Copy the source code
COPY . .

# Build the Go app
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o /api-service main.go

# Start a new, smaller stage from scratch
FROM alpine:latest

WORKDIR /root/

# Copy the Pre-built binary file from the previous stage
COPY --from=builder /api-service .
# COPY --from=builder /app/.env.example /root/.env.example
# COPY --from=builder /app/config /root/config


# Expose port 8080 (for running locally)
EXPOSE 8080

# Command to run the executable
CMD ["./api-service"] 