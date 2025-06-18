from langchain_community.tools import DuckDuckGoSearchRun
from langchain_core.tools import tool
from langchain_core.prompts import ChatPromptTemplate
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_cohere import CohereRerank
from langchain_core.documents import Document
import lancedb

from config import settings
from agent import dependencies
from agent import prompts

# --- Web Search Tool ---
# This is a standard tool for performing web searches.
web_search_tool = DuckDuckGoSearchRun()

# --- Hypothetical Document Generation (HyDE) ---
hyde_prompt_template = ChatPromptTemplate.from_messages([
    ("system", prompts.HYDE_PROMPT),
    ("human", "User Query: {query}"),
])

# Use the same LLM as the main agent for consistency
hyde_llm = ChatGoogleGenerativeAI(model=settings.GEMINI_MODEL_NAME, temperature=0)
hyde_chain = hyde_prompt_template | hyde_llm

# --- Reranker Initialization ---
# The user needs to provide a Cohere API key in the environment variables.
reranker = CohereRerank(
    cohere_api_key=settings.COHERE_API_KEY, 
    model="rerank-english-v3.0",  # Cohere's latest rerank model
    top_n=10
)


# --- Codebase Search Tool ---
@tool
def codebase_search_tool(query: str) -> str:
    """
    Searches the project's codebase for relevant snippets using a sophisticated
    hybrid search and reranking strategy.

    This multi-step process includes:
    1.  **HyDE (Hypothetical Document Embeddings):** Generates a hypothetical code snippet to better capture the user's intent for vector search.
    2.  **Hybrid Search:** Performs both a keyword-based full-text search (BM25-like) and a dense vector search using the HyDE embedding.
    3.  **Reranking:** Uses a Cohere model to rerank the combined results for maximum relevance.
    """
    print(f"--- INFO: Advanced codebase search started for query: '{query}' ---")

    if not dependencies.db_connection or not dependencies.embedding_model:
        return "Error: Codebase search tool is not initialized. The database connection or embedding model is missing."

    try:
        table = dependencies.db_connection.open_table(settings.LANCEDB_TABLE_NAME)
    except FileNotFoundError:
        return f"Error: The LanceDB table '{settings.LANCEDB_TABLE_NAME}' was not found. The database may be empty or the index name is incorrect."

    # 1. HyDE: Generate a hypothetical document
    print("  - Step 1: Generating hypothetical document (HyDE)...")
    hypothetical_doc = hyde_chain.invoke({"query": query}).content
    print(f"  - HyDE document generated:\n---\n{hypothetical_doc}\n---")
    query_vector = dependencies.embedding_model.embed_query(hypothetical_doc)

    # 2. Hybrid Search
    print("  - Step 2: Performing hybrid search (vector + keyword)...")
    # Vector search with the HyDE embedding
    vector_results = table.search(query_vector).limit(10).to_list()
    # Keyword search (BM25/FTS) with the original query.  If the FTS index is
    # still being built (or missing) LanceDB raises an error – we catch it and
    # fall back to vector-only results instead of propagating the exception to
    # the user.
    try:
        keyword_results = table.search(query).limit(10).to_list()
    except Exception as e:
        print(f"  - Keyword search skipped (FTS index not ready?): {e}")
        keyword_results = []

    # Combine and deduplicate results (use 'content' column which stores code text)
    combined_results = {res['content']: res for res in vector_results + keyword_results}.values()
    print(f"  - Found {len(list(combined_results))} unique snippets from hybrid search.")

    if not combined_results:
        return "No relevant code snippets found in the codebase for your query."

    # 3. Reranking
    print("  - Step 3: Reranking results with Cohere...")
    # LangChain's CohereRerank expects a list of Documents
    documents_to_rerank = [
        Document(page_content=res['content'], metadata={"file_path": res.get('file_path', 'Unknown file')})
        for res in combined_results
    ]
    
    reranked_docs = reranker.compress_documents(documents=documents_to_rerank, query=query)
    print(f"  - Reranked down to {len(reranked_docs)} snippets.")
    
    if not reranked_docs:
        return "No relevant code snippets found after reranking."

    # 4. Format final results
    formatted_results = []
    # top_n is handled by the reranker initialization
    for i, doc in enumerate(reranked_docs):
        file_path = doc.metadata.get('file_path', 'Unknown file')
        content = doc.page_content
        formatted_results.append(f"Snippet {i+1} from '{file_path}':\n```\n{content}\n```")
        
    final_output = "\n\n---\n\n".join(formatted_results)
    print(f"--- INFO: Advanced codebase search finished. Returning {len(reranked_docs)} snippets. ---")
    return final_output
