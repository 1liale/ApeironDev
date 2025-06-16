from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from langgraph.graph import StateGraph, END
from typing import TypedDict, List, Optional

from config import settings
from agent.tools import web_search_tool, codebase_search_tool
from agent import prompts

# --- 1. State Definition ---
class AgentState(TypedDict):
    """
    Represents the state of our agent in the LangGraph.
    """
    user_query: str                  
    raw_code_snippets: List[str]     
    raw_web_results: List[str]       
    summarized_context: Optional[str]
    next_action: Optional[str]       

# --- LLM and Tools Initialization ---
llm = ChatGoogleGenerativeAI(model=settings.GEMINI_MODEL_NAME, temperature=0)

# --- 2. Node Definitions ---

# Node 1: Plan Retrieval Strategy
class RetrievalStrategy(BaseModel):
    """The retrieval strategy to use for the user's query."""
    next_action: str = Field(description="The next action to take. One of: 'search_code_and_web', 'search_code_only', 'search_web_only', 'no_retrieval'")

def plan_retrieval_strategy(state: AgentState) -> dict:
    """Uses an LLM to determine the most relevant search type(s) based on the query."""
    print("---PLANNING RETRIEVAL STRATEGY---")
    
    structured_llm = llm.with_structured_output(RetrievalStrategy)
    
    prompt = ChatPromptTemplate.from_messages([
        ("system", prompts.PLANNER_PROMPT),
        ("human", "User Query: {user_query}"),
    ])
    
    chain = prompt | structured_llm
    result = chain.invoke({"user_query": state['user_query']})
    
    print(f"Chosen strategy: {result.next_action}")
    return {"next_action": result.next_action}

# Node 2: Retrieve Codebase Context
def retrieve_codebase_context(state: AgentState) -> dict:
    """Calls the Codebase Search Tool."""
    print("---RETRIEVING CODEBASE CONTEXT---")
    query = state['user_query']
    snippets = codebase_search_tool.invoke(query)
    return {"raw_code_snippets": [snippets]}

# Node 3: Retrieve Web Context
def retrieve_web_context(state: AgentState) -> dict:
    """Calls the Web Search Tool."""
    print("---RETRIEVING WEB CONTEXT---")
    query = state['user_query']
    web_results = web_search_tool.invoke(query)
    return {"raw_web_results": [web_results]}

# Node 4: Summarize Context
def summarize_context(state: AgentState) -> dict:
    """Summarizes all retrieved information into a focused, concise context."""
    print("---SUMMARIZING CONTEXT---")

    prompt = ChatPromptTemplate.from_messages([
        ("system", prompts.SUMMARIZER_PROMPT),
        ("human", "User Query: {user_query}\n\nCode Snippets:\n{code_snippets}\n\nWeb Results:\n{web_results}"),
    ])
    
    chain = prompt | llm
    
    summary = chain.invoke({
        "user_query": state['user_query'],
        "code_snippets": "\n---\n".join(state['raw_code_snippets']),
        "web_results": "\n---\n".join(state['raw_web_results']),
    })
    
    return {"summarized_context": summary.content}


# --- 3. Graph Flow Definition ---
workflow = StateGraph(AgentState)

# Add the nodes
workflow.add_node("plan_retrieval", plan_retrieval_strategy)
workflow.add_node("retrieve_codebase", retrieve_codebase_context)
workflow.add_node("retrieve_web", retrieve_web_context)
workflow.add_node("summarize_context", summarize_context)

# Set the entry point
workflow.set_entry_point("plan_retrieval")

# Define conditional edges from the planning node
def route_after_planning(state: AgentState) -> str:
    """Route to the appropriate next step based on the planning decision."""
    action = state['next_action']
    if action == "search_code_and_web":
        return "retrieve_codebase"  # We'll handle the web search after codebase
    elif action == "search_code_only":
        return "retrieve_codebase"
    elif action == "search_web_only":
        return "retrieve_web"
    else:  # no_retrieval
        return "summarize_context"

workflow.add_conditional_edges(
    "plan_retrieval",
    route_after_planning,
    {
        "retrieve_codebase": "retrieve_codebase",
        "retrieve_web": "retrieve_web",
        "summarize_context": "summarize_context",
    }
)

# For the "search_code_and_web" case, we need to route from codebase to web search
def route_after_codebase(state: AgentState) -> str:
    """Route after codebase search - check if we also need web search."""
    if state['next_action'] == "search_code_and_web":
        return "retrieve_web"
    else:
        return "summarize_context"

workflow.add_conditional_edges(
    "retrieve_codebase",
    route_after_codebase,
    {
        "retrieve_web": "retrieve_web",
        "summarize_context": "summarize_context",
    }
)

# After web retrieval, go to summarization
workflow.add_edge("retrieve_web", "summarize_context")

# The final node in this RAG segment
workflow.add_edge("summarize_context", END)

# Compile the graph
agent_graph = workflow.compile()

# Example of how to run it:
# from langchain_core.messages import HumanMessage
# inputs = {"messages": [HumanMessage(content="what is the speed of light?")]}
# for output in agent_graph.stream(inputs):
#     # stream() yields dictionaries with output from each node
#     for key, value in output.items():
#         print(f"Output from node '{key}':")
#         print("---")
#         print(value)
#     print("\n---\n") 