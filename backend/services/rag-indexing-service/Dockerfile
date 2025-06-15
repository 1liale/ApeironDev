# Use an official Python runtime as a parent image
FROM python:3.11-slim

# Set the working directory in the container
WORKDIR /app

# Copy the requirements file into the container at /app
COPY requirements.txt .

# Install system dependencies needed for tree-sitter to build its parsers
RUN apt-get update && apt-get install -y build-essential

# Install any needed packages specified in requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application's code into the container at /app
COPY . .

# Expose the port the app runs on (though it's not strictly necessary for a non-HTTP triggered service, it's good practice)
EXPOSE 8080

# The Functions Framework will start a server for us
CMD exec functions-framework --target=index_workspace_handler --port=8080 