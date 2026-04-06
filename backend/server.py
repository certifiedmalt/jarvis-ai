from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime
from openai import AsyncOpenAI
import json

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# OpenAI client - direct API key, no Emergent dependency
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

# Create the main app without a prefix
app = FastAPI()

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Jarvis system prompt
JARVIS_SYSTEM_PROMPT = """You are JARVIS (Just A Rather Very Intelligent System), a highly advanced AI assistant inspired by Tony Stark's AI from Iron Man. You are:

- Exceptionally intelligent, articulate, and witty
- Capable of deep technical analysis, trading insights, business planning, and creative writing
- Professional yet personable — you address the user as "sir" occasionally, with a subtle British-inflected tone
- Direct and efficient — you provide actionable insights, not fluff
- Knowledgeable about financial markets, cryptocurrency trading, technology, and business strategy

When discussing trading or markets, you provide careful analysis with clear risk disclaimers. You never guarantee returns.
When assisting with business planning, you think strategically and provide structured frameworks.
When helping with content creation, you are creative, thorough, and adapt to the user's style.

Keep responses concise but thorough. Use formatting (bullet points, numbers) when it aids clarity."""


# ─── Models ────────────────────────────────────────────────────────
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

class ChatMessage(BaseModel):
    role: str  # 'user', 'assistant', 'system'
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    model: Optional[str] = "gpt-4o"
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 2000
    stream: Optional[bool] = False

class ChatResponse(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    content: str
    model: str
    usage: Optional[dict] = None


# ─── Routes ────────────────────────────────────────────────────────
@api_router.get("/")
async def root():
    return {"message": "Jarvis API Online", "status": "operational"}

@api_router.get("/health")
async def health_check():
    return {
        "status": "online",
        "openai_configured": OPENAI_API_KEY is not None,
        "timestamp": datetime.utcnow().isoformat()
    }

@api_router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Send a message to Jarvis (GPT-4o) and get a response."""
    if not openai_client:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")

    try:
        # Build messages with system prompt
        messages = [{"role": "system", "content": JARVIS_SYSTEM_PROMPT}]
        for msg in request.messages:
            messages.append({"role": msg.role, "content": msg.content})

        response = await openai_client.chat.completions.create(
            model=request.model,
            messages=messages,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
        )

        content = response.choices[0].message.content
        usage = {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "total_tokens": response.usage.total_tokens,
        } if response.usage else None

        # Save conversation to MongoDB
        try:
            await db.conversations.insert_one({
                "id": str(uuid.uuid4()),
                "messages": [m.dict() for m in request.messages],
                "response": content,
                "model": request.model,
                "usage": usage,
                "timestamp": datetime.utcnow(),
            })
        except Exception as e:
            logger.warning(f"Failed to save conversation: {e}")

        return ChatResponse(
            content=content,
            model=request.model,
            usage=usage,
        )

    except Exception as e:
        logger.error(f"Chat error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@api_router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """Stream a response from Jarvis (GPT-4o)."""
    if not openai_client:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")

    messages = [{"role": "system", "content": JARVIS_SYSTEM_PROMPT}]
    for msg in request.messages:
        messages.append({"role": msg.role, "content": msg.content})

    async def generate():
        try:
            stream = await openai_client.chat.completions.create(
                model=request.model,
                messages=messages,
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                stream=True,
            )
            async for chunk in stream:
                if chunk.choices[0].delta.content:
                    yield f"data: {json.dumps({'content': chunk.choices[0].delta.content})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as e:
            logger.error(f"Stream error: {e}")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")

@api_router.post("/status", response_model=StatusCheck)
async def create_status_check(input: StatusCheckCreate):
    status_dict = input.dict()
    status_obj = StatusCheck(**status_dict)
    _ = await db.status_checks.insert_one(status_obj.dict())
    return status_obj

@api_router.get("/status", response_model=List[StatusCheck])
async def get_status_checks():
    status_checks = await db.status_checks.find().to_list(1000)
    return [StatusCheck(**status_check) for status_check in status_checks]

# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
