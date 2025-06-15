# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container at /app
COPY requirements.txt .

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application's code into the container at /app
COPY . .

# Expose the port the app runs on
EXPOSE 8080

# Define the command to run the application
# Uvicorn is a lightning-fast ASGI server, running on 0.0.0.0 to be accessible from outside the container
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"] 