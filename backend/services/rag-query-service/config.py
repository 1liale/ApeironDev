import os
from pydantic_settings import BaseSettings
from pydantic import computed_field

class Settings(BaseSettings):
    """
    Service configuration settings.
    By default, Pydantic BaseSettings automatically reads from environment
    variables.
    """

    # R2/S3 Configuration for LanceDB
    R2_ACCESS_KEY_ID: str
    R2_SECRET_ACCESS_KEY: str
    R2_ACCOUNT_ID: str
    R2_BUCKET_NAME: str

    # Google Cloud Configuration
    GCP_PROJECT_ID: str
    GCP_REGION: str = "us-east1"

    # Cohere Configuration for Reranking
    COHERE_API_KEY: str

    # Google AI Configuration
    GOOGLE_API_KEY: str

    # Gemini Model Configuration
    GEMINI_MODEL_NAME: str = "gemini-1.5-pro"
    EMBEDDING_MODEL_NAME: str = "models/text-embedding-004"
    EMBEDDING_MODEL_DIM: int = 768

    # LanceDB Configuration
    LANCEDB_TABLE_NAME: str = "code-vectors"
    LANCEDB_SUB_PATH: str = "lancedb-data"

    # Computed properties for convenience
    @computed_field
    @property
    def R2_ENDPOINT_URL(self) -> str:
        """Construct the S3-compatible endpoint URL for R2."""
        return f"https://{self.R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

    @computed_field
    @property
    def LANCEDB_URI(self) -> str:
        """Construct the LanceDB URI from bucket and sub-path."""
        return f"s3://{self.R2_BUCKET_NAME}/{self.LANCEDB_SUB_PATH}"

# Create a single settings instance to be used across the application
settings = Settings() 