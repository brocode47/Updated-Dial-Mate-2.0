import os
from typing import Optional
from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.agents.main_agent import main_agent

app = FastAPI(
    title="Dial Mate AI Engine",
    version="2.0.0",
    description="Production Multi-Tenant AI Engine for DialMate 2.0"
)

AI_ENGINE_API_KEY = os.getenv("AI_ENGINE_API_KEY", "")


class ChatRequest(BaseModel):
    shop_id: str = Field(..., min_length=1, description="Tenant Shop UUID")
    customer_phone: str = Field(..., min_length=1, description="Customer Phone Number")
    message: str = Field(..., min_length=1, description="Customer Message")


class ChatResponse(BaseModel):
    response: str
    agent: str
    intent: str
    confidence: float
    conversation_id: Optional[str] = None
    type: str = "conversation"


def _verify_security(request: Request, x_ai_engine_key: Optional[str]):
    """
    Verifies internal API security:
    - If AI_ENGINE_API_KEY is configured in env, strictly require matching X-AI-ENGINE-KEY.
    - If AI_ENGINE_API_KEY is not set (development mode), allow localhost callers only.
    - Reject all external/unauthorized callers.
    """
    client_host = request.client.host if request.client else "127.0.0.1"
    is_localhost = client_host in ["127.0.0.1", "::1", "localhost", "testclient"]
    expected_key = os.getenv("AI_ENGINE_API_KEY", AI_ENGINE_API_KEY)

    if expected_key:
        if x_ai_engine_key != expected_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unauthorized: Invalid or missing X-AI-ENGINE-KEY"
            )
    else:
        # Development mode fallback: allow localhost only
        if not is_localhost:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Unauthorized: External access requires AI_ENGINE_API_KEY"
            )


@app.get("/")
def home():
    return {
        "status": "running",
        "service": "Dial Mate AI Engine",
        "version": "2.0.0"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "service": "Dial Mate AI Engine"
    }


@app.post("/chat", response_model=ChatResponse)
async def chat(
    payload: ChatRequest,
    request: Request,
    x_ai_engine_key: Optional[str] = Header(None, alias="X-AI-ENGINE-KEY")
):
    """
    Production multi-tenant conversational AI bridge:
    - Verifies internal microservice credentials
    - Scopes customer memory and conversation by shop_id + customer_phone
    - Deterministically routes query in <1ms without LLM latency
    - Returns structured response contract with agent and intent metadata
    """
    _verify_security(request, x_ai_engine_key)

    try:
        result = main_agent(
            message=payload.message,
            phone=payload.customer_phone,
            shop_id=payload.shop_id
        )

        return ChatResponse(
            response=result.get("response", ""),
            agent=result.get("agent", "support_agent"),
            intent=result.get("intent", "unknown_query"),
            confidence=float(result.get("confidence", 0.95)),
            conversation_id=result.get("conversation_id"),
            type=result.get("type", "conversation")
        )

    except Exception as e:
        print(f"[AI Engine Error] Error processing /chat request: {e}")
        # Return graceful fallback contract per production requirement 8
        return JSONResponse(
            status_code=200,
            content={
                "response": "Jee, main aap ki madad ke liye hazir hoon. Aap apna sawal bata dein.",
                "agent": "support_agent",
                "intent": "unknown_query",
                "confidence": 0.0,
                "conversation_id": None,
                "type": "conversation"
            }
        )
