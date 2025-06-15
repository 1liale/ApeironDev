import functions_framework
from flask import Request, jsonify
from pydantic import BaseModel, Field
from typing import List
import lancedb
import boto3
import os
from botocore.client import Config
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_text_splitters import TreeSitterTextSplitter, Language, RecursiveCharacterTextSplitter
from lancedb.pydantic import LanceModel, Vector

from .config import settings

# --- Pydantic Models & LanceDB Schema ---
class FileUpdate(BaseModel):
    """A single file that was updated in the commit."""
    file_path: str = Field(..., description="The full path of the file in the R2 bucket.")
    # In the future, we could add status: "created" | "updated" | "deleted"

class IndexRequest(BaseModel):
    """The request body for the indexing function."""
    workspace_id: str = Field(..., description="The ID of the workspace being updated.")
    files: List[FileUpdate] = Field(..., description="A list of files that were updated.")

class CodeSnippet(LanceModel):
    """Pydantic model for the data we'll store in LanceDB."""
    vector: Vector(settings.EMBEDDING_MODEL_DIM)
    text: str
    file_path: str
    workspace_id: str

# --- Clients and Splitter Initialization ---
# These are initialized globally to be reused across function invocations.
embeddings_model = GoogleGenerativeAIEmbeddings(model=settings.EMBEDDING_MODEL_NAME)

s3_client = boto3.client(
    "s3",
    endpoint_url=settings.R2_ENDPOINT_URL,
    aws_access_key_id=settings.R2_ACCESS_KEY_ID,
    aws_secret_access_key=settings.R2_SECRET_ACCESS_KEY,
    region_name="auto", # R2 doesn't use regions, 'auto' is a safe default
    config=Config(signature_version='s3v4')
)

# Text splitter is now determined dynamically based on file type.

# --- Cloud Function Entrypoint ---
@functions_framework.http
def index_workspace_handler(request: Request):
    """
    HTTP Cloud Function to index workspace code changes into LanceDB.
    
    This function is triggered by the Go API service after a successful commit.
    """
    if request.method != 'POST':
        return 'Only POST method is accepted', 405

    try:
        json_data = request.get_json(silent=True)
        if not json_data:
            return jsonify({"error": "Invalid JSON"}), 400
        
        index_request = IndexRequest.model_validate(json_data)
        print(f"Received indexing request for workspace: {index_request.workspace_id}")

        # Connect to LanceDB
        storage_options = {
            "aws_access_key_id": settings.R2_ACCESS_KEY_ID,
            "aws_secret_access_key": settings.R2_SECRET_ACCESS_KEY,
            "aws_endpoint_url": settings.R2_ENDPOINT_URL,
            "aws_region": "auto",
        }
        db = lancedb.connect(settings.LANCEDB_URI, storage_options=storage_options)
        
        # We pass the Pydantic model directly to create the table
        table = db.create_table(settings.LANCEDB_TABLE_NAME, schema=CodeSnippet, exist_ok=True)
        
        # Create a full-text search index on the 'text' column if it doesn't exist.
        # This is crucial for hybrid search (keyword + vector).
        # Using replace=True ensures the index is up-to-date with any potential configuration changes.
        try:
            table.create_fts_index("text", replace=True)
            print("  - Ensured FTS index exists for 'text' column.")
        except Exception as e:
            print(f"  - Warning: Could not create FTS index. Keyword search may not be available. Error: {e}")
        
        snippets_to_process = []

        # We'll use a fallback for any language not explicitly supported with tree-sitter
        fallback_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)

        for file in index_request.files:
            file_path = file.file_path
            print(f"Processing file: {file_path}")

            # 1. Delete existing vectors for this file to ensure freshness
            try:
                table.delete(f"file_path = '{file_path}' AND workspace_id = '{index_request.workspace_id}'")
                print(f"  - Deleted old snippets for {file_path}")
            except Exception as e:
                # This might fail if the table is empty, which is fine.
                print(f"  - Could not delete old snippets for {file_path} (may be new file): {e}")

            # 2. Download file content from R2
            try:
                response = s3_client.get_object(Bucket=settings.R2_BUCKET_NAME, Key=file_path)
                file_content = response['Body'].read().decode('utf-8')
            except s3_client.exceptions.NoSuchKey:
                print(f"  - File not found in R2: {file_path}. Assuming it was deleted.")
                continue # Skip to the next file
            
            # 3. Chunk the file content based on its type
            _, file_extension = os.path.splitext(file_path)
            
            chunks = []
            if file_extension == ".py":
                # Use tree-sitter for precise, syntax-aware chunking for Python files
                python_splitter = TreeSitterTextSplitter(language="python", chunk_on=["class_definition", "function_definition"])
                chunks = python_splitter.split_text(file_content)
                print(f"  - Split file using tree-sitter (Python) into {len(chunks)} chunks.")
            else:
                # Use a recursive character splitter as a fallback for other file types
                chunks = fallback_splitter.split_text(file_content)
                print(f"  - Split file using fallback splitter into {len(chunks)} chunks.")

            # 4. Collect all chunks with their metadata
            for chunk in chunks:
                snippets_to_process.append({
                    "text": chunk,
                    "file_path": file_path,
                    "workspace_id": index_request.workspace_id,
                })
        
        # 5. Perform batch embedding and add to table
        if snippets_to_process:
            print(f"Embedding {len(snippets_to_process)} new snippets...")
            
            # Extract just the text for batch embedding
            texts_to_embed = [s['text'] for s in snippets_to_process]
            vectors = embeddings_model.embed_documents(texts_to_embed)
            
            # Create the final list of data to add to LanceDB
            data_to_add = []
            for i, snippet_data in enumerate(snippets_to_process):
                data_to_add.append(CodeSnippet(
                    vector=vectors[i],
                    text=snippet_data['text'],
                    file_path=snippet_data['file_path'],
                    workspace_id=snippet_data['workspace_id']
                ))

            print(f"Adding {len(data_to_add)} new snippets to LanceDB...")
            table.add(data_to_add)
            print("  - Successfully added snippets.")
        else:
            print("No new snippets to add.")

        return jsonify({
            "status": "success",
            "message": f"Successfully processed {len(index_request.files)} files for workspace {index_request.workspace_id}.",
            "snippets_added": len(snippets_to_process),
        }), 200

    except Exception as e:
        print(f"FATAL: Error processing indexing request: {e}")
        return jsonify({"error": "Internal Server Error"}), 500 