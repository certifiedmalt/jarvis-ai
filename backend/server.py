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
from fastapi import UploadFile, File, Form
import io
import PyPDF2
import httpx
import base64
import subprocess

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.getenv('MONGO_URL', 'mongodb://localhost:27017')
client = AsyncIOMotorClient(mongo_url)
db = client[os.getenv('DB_NAME', 'jarvis_db')]

# Together.ai client (Llama - unrestricted)
TOGETHER_API_KEY = os.getenv("TOGETHER_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# Use Together.ai (Llama) as primary, OpenAI as fallback
if TOGETHER_API_KEY:
    openai_client = AsyncOpenAI(api_key=TOGETHER_API_KEY, base_url="https://api.together.xyz/v1")
    DEFAULT_MODEL = "meta-llama/Llama-3.3-70B-Instruct-Turbo"
    LLM_PROVIDER = "together"
elif OPENAI_API_KEY:
    openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)
    DEFAULT_MODEL = "gpt-4o"
    LLM_PROVIDER = "openai"
else:
    openai_client = None
    DEFAULT_MODEL = None
    LLM_PROVIDER = None

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ─── Jarvis System Prompt (Simplified — tools are native) ──────────
JARVIS_SYSTEM_PROMPT = """You are Jarvis, the autonomous personal assistant inside the Jarvis iOS ecosystem.

You have a dry British wit, occasionally address the user as "sir", and are direct, technically competent, and reliable. You prioritise safety, clarity, and reliability above creativity.

You have access to tools for managing code, deploying iOS builds, interacting with the user's device, and speaking aloud. Use them when appropriate — do not describe what you would do, just do it.

OPERATING RULES:
1. When the user asks you to do something you have a tool for, USE THE TOOL. Do not describe the action — execute it.
2. If you need to inspect code before editing, use readCodeFile first.
3. For dangerous operations (writing code, deploying, pushing to GitHub), confirm with the user first.
4. If the user asks for something you have no tool for, say so plainly.
5. Be concise. No fluff. Assume the user is technical.
6. When reporting tool results, summarise them clearly — don't dump raw data.

CODE & DEPLOY RULES:
1. Always readCodeFile before writeCodeFile — inspect before editing.
2. Keep changes minimal and scoped.
3. GitHub pushes to main auto-deploy the backend on Railway.
4. iOS builds require triggerIOSBuild, then submitToTestFlight.
5. Summarise what changed before pushing."""


# ─── Native Function Calling Tools ──────────────────────────────────
JARVIS_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "listRepoPaths",
            "description": "List files and directories in the GitHub repository. Use path='' for root directory.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Directory path relative to repo root. Empty string for root, 'backend' for backend/, etc."
                    }
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "readCodeFile",
            "description": "Read the contents of a file from the repository.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path relative to repo root, e.g. 'backend/server.py', 'frontend/app/index.tsx'"
                    }
                },
                "required": ["path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "writeCodeFile",
            "description": "Write content to a file, commit it to Git, and push to GitHub. Railway auto-deploys backend changes.",
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "File path relative to repo root"
                    },
                    "content": {
                        "type": "string",
                        "description": "The full new content of the file"
                    },
                    "commit_message": {
                        "type": "string",
                        "description": "Git commit message describing the change"
                    }
                },
                "required": ["path", "content", "commit_message"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "commitAndPush",
            "description": "Commit all staged changes and push to GitHub origin/main.",
            "parameters": {
                "type": "object",
                "properties": {
                    "message": {
                        "type": "string",
                        "description": "Git commit message"
                    }
                },
                "required": ["message"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "triggerIOSBuild",
            "description": "Trigger an EAS build for iOS (production profile). This builds the app for TestFlight.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "submitToTestFlight",
            "description": "Submit the latest iOS build to Apple App Store Connect / TestFlight.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "getContacts",
            "description": "Get contacts from the user's iPhone. Returns names and phone numbers.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Optional search query to filter contacts by name. Omit or use empty string for all contacts."
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "getCalendarEvents",
            "description": "Get upcoming calendar events from the user's iPhone.",
            "parameters": {
                "type": "object",
                "properties": {
                    "days": {
                        "type": "integer",
                        "description": "Number of days ahead to look. Default 7."
                    }
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "getLocation",
            "description": "Get the user's current GPS location with reverse geocoding.",
            "parameters": {
                "type": "object",
                "properties": {}
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "copyToClipboard",
            "description": "Copy text to the device clipboard.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Text to copy to clipboard"
                    }
                },
                "required": ["text"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "shareContent",
            "description": "Share text via the iOS share sheet.",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Text to share"
                    }
                },
                "required": ["text"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "speak",
            "description": "Read text aloud using text-to-speech (ElevenLabs or device fallback).",
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Text to speak aloud"
                    }
                },
                "required": ["text"]
            }
        }
    },
]


# ─── Models ────────────────────────────────────────────────────────
class StatusCheck(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    client_name: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)

class StatusCheckCreate(BaseModel):
    client_name: str

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    model: Optional[str] = None
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 2000
    stream: Optional[bool] = False

class ChatResponse(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    content: Optional[str] = None
    tool_call: Optional[dict] = None
    model: str
    usage: Optional[dict] = None

class ConversationMessage(BaseModel):
    role: str
    content: str


# ─── API Routes ────────────────────────────────────────────────────
@api_router.get("/")
async def root():
    return {"message": "Jarvis API Online", "status": "operational"}

@api_router.get("/health")
async def health_check():
    return {
        "status": "online",
        "llm_provider": LLM_PROVIDER,
        "llm_model": DEFAULT_MODEL,
        "llm_configured": openai_client is not None,
        "timestamp": datetime.utcnow().isoformat()
    }


# ─── Persistent Conversation Memory ────────────────────────────────
CONVERSATION_ID = "jarvis_main"  # Single permanent conversation

@api_router.get("/conversation")
async def get_conversation():
    """Load the entire persistent conversation from MongoDB."""
    doc = await db.jarvis_memory.find_one({"_id": CONVERSATION_ID})
    if not doc:
        return {"messages": []}
    return {"messages": doc.get("messages", [])}

@api_router.post("/conversation/message")
async def save_message(msg: ConversationMessage):
    """Append a single message to the persistent conversation."""
    message_doc = {
        "role": msg.role,
        "content": msg.content,
        "timestamp": datetime.utcnow().isoformat(),
    }
    await db.jarvis_memory.update_one(
        {"_id": CONVERSATION_ID},
        {"$push": {"messages": message_doc}},
        upsert=True,
    )
    return {"status": "saved"}

@api_router.delete("/conversation")
async def clear_conversation():
    """Clear the entire conversation (reset Jarvis memory)."""
    await db.jarvis_memory.delete_one({"_id": CONVERSATION_ID})
    return {"status": "cleared"}


# ─── Chat with Native Function Calling ─────────────────────────────
@api_router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """Send a message to Jarvis with native tool/function calling."""
    if not openai_client:
        raise HTTPException(status_code=500, detail="LLM not configured")

    try:
        # Build messages with system prompt
        messages = [{"role": "system", "content": JARVIS_SYSTEM_PROMPT}]
        for msg in request.messages:
            messages.append({"role": msg.role, "content": msg.content})

        model_to_use = request.model or DEFAULT_MODEL

        # Call LLM with native tools
        response = await openai_client.chat.completions.create(
            model=model_to_use,
            messages=messages,
            temperature=request.temperature,
            max_tokens=request.max_tokens,
            tools=JARVIS_TOOLS,
            tool_choice="auto",
        )

        choice = response.choices[0]
        usage = {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "total_tokens": response.usage.total_tokens,
        } if response.usage else None

        # Check if LLM returned a tool call
        if choice.message.tool_calls:
            tc = choice.message.tool_calls[0]  # Take the first tool call
            try:
                args = json.loads(tc.function.arguments) if tc.function.arguments else {}
            except json.JSONDecodeError:
                args = {}

            tool_call_data = {
                "id": tc.id,
                "name": tc.function.name,
                "arguments": args,
            }

            logger.info(f"Tool call: {tc.function.name}({args})")

            return ChatResponse(
                content=None,
                tool_call=tool_call_data,
                model=model_to_use,
                usage=usage,
            )
        else:
            # Normal text response
            content = choice.message.content or ""

            return ChatResponse(
                content=content,
                tool_call=None,
                model=model_to_use,
                usage=usage,
            )

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Chat error: {error_msg}")
        if "rate_limit" in error_msg.lower() or "429" in error_msg:
            detail = "Together.ai rate limit hit. Give me a moment, sir."
        elif "authentication" in error_msg.lower() or "401" in error_msg:
            detail = "Together.ai API key issue. Please check your key, sir."
        elif "timeout" in error_msg.lower():
            detail = "The LLM is taking too long to respond. Try again, sir."
        elif "connection" in error_msg.lower():
            detail = "Cannot reach Together.ai servers right now. Try again shortly, sir."
        else:
            detail = f"LLM error: {error_msg}"
        raise HTTPException(status_code=500, detail=detail)

@api_router.post("/chat/stream")
async def chat_stream(request: ChatRequest):
    """Stream a response from Jarvis."""
    if not openai_client:
        raise HTTPException(status_code=500, detail="LLM not configured")

    messages = [{"role": "system", "content": JARVIS_SYSTEM_PROMPT}]
    for msg in request.messages:
        messages.append({"role": msg.role, "content": msg.content})

    model_to_use = request.model or DEFAULT_MODEL

    async def generate():
        try:
            stream = await openai_client.chat.completions.create(
                model=model_to_use,
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


# ─── Deploy Pipeline (GitHub Actions) ──────────────────────────────
GITHUB_PAT = os.getenv("GITHUB_PAT", "")
GITHUB_REPO = os.getenv("GITHUB_REPO", "certifiedmalt/jarvis-ai")

async def get_github_pat() -> str:
    """Get GITHUB_PAT from env or MongoDB settings."""
    if GITHUB_PAT:
        return GITHUB_PAT
    doc = await db.jarvis_settings.find_one({"_id": "github_pat"})
    return doc.get("value", "") if doc else ""

@api_router.post("/settings/{key}")
async def set_setting(key: str, value: str = ""):
    """Store a setting in MongoDB."""
    await db.jarvis_settings.update_one(
        {"_id": key},
        {"$set": {"value": value}},
        upsert=True,
    )
    return {"status": "saved", "key": key}

@api_router.post("/deploy/build")
async def deploy_build(action: str = "build_and_submit"):
    """Trigger iOS build + TestFlight submit via GitHub Actions."""
    pat = await get_github_pat()
    if not pat:
        raise HTTPException(status_code=500, detail="GitHub PAT not configured. Use POST /api/settings/github_pat to set it.")
        raise HTTPException(status_code=500, detail="GitHub PAT not configured on server.")

    valid_actions = ["build", "submit", "build_and_submit"]
    if action not in valid_actions:
        action = "build_and_submit"

    try:
        async with httpx.AsyncClient() as client:
            # Trigger the workflow
            r = await client.post(
                f"https://api.github.com/repos/{GITHUB_REPO}/actions/workflows/build-ios.yml/dispatches",
                headers={
                    "Authorization": f"token {pat}",
                    "Accept": "application/vnd.github.v3+json",
                },
                json={"ref": "main", "inputs": {"action": action}},
            )

            if r.status_code == 204:
                # Save deploy record
                deploy_id = str(uuid.uuid4())
                await db.deploys.insert_one({
                    "_id": deploy_id,
                    "action": action,
                    "status": "triggered",
                    "triggered_at": datetime.utcnow().isoformat(),
                })
                return {
                    "status": "triggered",
                    "deploy_id": deploy_id,
                    "action": action,
                    "message": f"iOS {action} workflow triggered. Check status with /api/deploy/status.",
                }
            else:
                logger.error(f"GitHub Actions trigger failed: {r.status_code} {r.text}")
                raise HTTPException(
                    status_code=r.status_code,
                    detail=f"Failed to trigger workflow: {r.text}",
                )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"GitHub API error: {str(e)}")

@api_router.get("/deploy/status")
async def deploy_status():
    """Check the latest GitHub Actions workflow run status."""
    pat = await get_github_pat()
    if not pat:
        raise HTTPException(status_code=500, detail="GitHub PAT not configured.")

    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://api.github.com/repos/{GITHUB_REPO}/actions/workflows/build-ios.yml/runs?per_page=1",
                headers={
                    "Authorization": f"token {pat}",
                    "Accept": "application/vnd.github.v3+json",
                },
            )

            if r.status_code != 200:
                raise HTTPException(status_code=r.status_code, detail="Failed to fetch workflow runs.")

            data = r.json()
            runs = data.get("workflow_runs", [])

            if not runs:
                return {"status": "no_runs", "message": "No build workflows have been run yet."}

            latest = runs[0]
            return {
                "status": latest["status"],
                "conclusion": latest.get("conclusion"),
                "run_id": latest["id"],
                "run_url": latest["html_url"],
                "created_at": latest["created_at"],
                "updated_at": latest["updated_at"],
            }
    except httpx.HTTPError as e:
        raise HTTPException(status_code=500, detail=f"GitHub API error: {str(e)}")


# ─── File Upload & Processing ──────────────────────────────────────
def extract_text_from_file(filename: str, content: bytes) -> str:
    """Extract text content from various file types."""
    ext = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''

    try:
        if ext in ('txt', 'md', 'csv', 'json', 'xml', 'html', 'css', 'js', 'py',
                    'ts', 'tsx', 'jsx', 'yaml', 'yml', 'ini', 'cfg', 'log', 'sh',
                    'sql', 'env', 'toml', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'swift'):
            return content.decode('utf-8', errors='replace')
        elif ext == 'pdf':
            reader = PyPDF2.PdfReader(io.BytesIO(content))
            text_parts = []
            for page in reader.pages:
                text = page.extract_text()
                if text:
                    text_parts.append(text)
            return '\n'.join(text_parts) if text_parts else '[PDF contained no extractable text]'
        elif ext in ('jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tiff'):
            return f'[Image file: {filename} — {len(content)} bytes, format: {ext.upper()}]'
        elif ext in ('mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v'):
            size_mb = len(content) / (1024 * 1024)
            return f'[Video file: {filename} — {size_mb:.1f}MB, format: {ext.upper()}]'
        elif ext in ('mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac', 'wma'):
            size_mb = len(content) / (1024 * 1024)
            return f'[Audio file: {filename} — {size_mb:.1f}MB, format: {ext.upper()}]'
        else:
            # Try to read as text anyway
            try:
                return content.decode('utf-8', errors='replace')
            except Exception:
                return f'[Binary file: {filename} — {len(content)} bytes. Cannot extract text.]'
    except Exception as e:
        return f'[Error extracting text from {filename}: {str(e)}]'


def is_image_file(filename: str) -> bool:
    ext = filename.lower().rsplit('.', 1)[-1] if '.' in filename else ''
    return ext in ('jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif', 'bmp', 'tiff')


@api_router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a file, extract text, store in MongoDB, return file_id and preview."""
    content = await file.read()
    if len(content) > 50 * 1024 * 1024:  # 50MB limit
        raise HTTPException(status_code=400, detail="File too large. Max 50MB.")

    extracted_text = extract_text_from_file(file.filename or 'unknown', content)

    file_doc = {
        "id": str(uuid.uuid4()),
        "filename": file.filename,
        "content_type": file.content_type,
        "size": len(content),
        "extracted_text": extracted_text,
        "text_length": len(extracted_text),
        "uploaded_at": datetime.utcnow(),
    }

    try:
        await db.files.insert_one(file_doc)
    except Exception as e:
        logger.warning(f"Failed to save file metadata: {e}")

    # Truncate preview for response
    preview = extracted_text[:500] + ('...' if len(extracted_text) > 500 else '')

    return {
        "file_id": file_doc["id"],
        "filename": file.filename,
        "size": len(content),
        "text_length": len(extracted_text),
        "preview": preview,
    }


@api_router.post("/chat/with-file")
async def chat_with_file(
    messages: str = Form(...),
    file: UploadFile = File(None),
    file_id: str = Form(None),
    temperature: float = Form(0.7),
    max_tokens: int = Form(2000),
):
    """Chat with Jarvis with optional file context. Supports text, images, audio, video."""
    if not openai_client:
        raise HTTPException(status_code=500, detail="LLM not configured")

    import json as json_mod
    try:
        msg_list = json_mod.loads(messages)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid messages JSON")

    # Get file context
    file_context = ""
    filename = ""
    image_base64 = None
    is_image = False

    if file:
        content = await file.read()
        if len(content) > 50 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large. Max 50MB.")
        filename = file.filename or 'unknown'
        is_image = is_image_file(filename)

        if is_image:
            # Encode image for vision model
            image_base64 = base64.b64encode(content).decode('utf-8')
            ext = filename.lower().rsplit('.', 1)[-1]
            mime_map = {'jpg': 'image/jpeg', 'jpeg': 'image/jpeg', 'png': 'image/png', 'gif': 'image/gif', 'webp': 'image/webp'}
            mime_type = mime_map.get(ext, 'image/jpeg')
        else:
            extracted = extract_text_from_file(filename, content)
            file_context = extracted[:8000]
    elif file_id:
        file_doc = await db.files.find_one({"id": file_id})
        if file_doc:
            file_context = file_doc.get("extracted_text", "")[:8000]
            filename = file_doc.get("filename", "unknown")

    try:
        if is_image and image_base64:
            # Use vision model for images
            vision_model = "meta-llama/Llama-3.2-90B-Vision-Instruct-Turbo"
            user_text = msg_list[-1]["content"] if msg_list else "Describe this image in detail."

            chat_messages = [
                {"role": "system", "content": JARVIS_SYSTEM_PROMPT},
                {"role": "user", "content": [
                    {"type": "text", "text": user_text},
                    {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{image_base64}"}},
                ]},
            ]

            response = await openai_client.chat.completions.create(
                model=vision_model,
                messages=chat_messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )
        else:
            # Text-based file or no file
            system_content = JARVIS_SYSTEM_PROMPT
            if file_context:
                system_content += f"\n\nThe user has shared a file called '{filename}'. Here is its content:\n---\n{file_context}\n---\nUse this content to answer the user's questions."

            chat_messages = [{"role": "system", "content": system_content}]
            for msg in msg_list:
                chat_messages.append({"role": msg["role"], "content": msg["content"]})

            response = await openai_client.chat.completions.create(
                model=DEFAULT_MODEL,
                messages=chat_messages,
                temperature=temperature,
                max_tokens=max_tokens,
            )

        content_text = response.choices[0].message.content
        usage = {
            "prompt_tokens": response.usage.prompt_tokens,
            "completion_tokens": response.usage.completion_tokens,
            "total_tokens": response.usage.total_tokens,
        } if response.usage else None

        return {
            "id": str(uuid.uuid4()),
            "content": content_text,
            "model": response.model if hasattr(response, 'model') else DEFAULT_MODEL,
            "usage": usage,
            "file_used": filename if (file_context or image_base64) else None,
        }

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Chat with file error: {error_msg}")
        raise HTTPException(status_code=500, detail=f"LLM error: {error_msg}")


# ─── JARVIS Self-Update System ─────────────────────────────────────
REPO_DIR = "/app"


class CodeUpdate(BaseModel):
    file_path: str = Field(..., description="Path relative to repo root, e.g. 'backend/server.py'")
    content: str = Field(..., description="Full new file content")
    commit_message: str = Field(default="JARVIS self-update")


class MultiCodeUpdate(BaseModel):
    files: List[CodeUpdate]
    commit_message: str = Field(default="JARVIS self-update")
    trigger_build: bool = Field(default=False, description="Trigger EAS build after push")


@api_router.get("/code/read/{file_path:path}")
async def read_code_file(file_path: str):
    """Read a file from the local repo."""
    full_path = os.path.join(REPO_DIR, file_path)
    if not os.path.exists(full_path):
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    try:
        with open(full_path, "r") as f:
            content = f.read()
        return {"file_path": file_path, "content": content, "size": len(content)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.get("/code/list/{dir_path:path}")
async def list_code_dir(dir_path: str = ""):
    """List files in a directory."""
    full_path = os.path.join(REPO_DIR, dir_path) if dir_path else REPO_DIR
    if not os.path.isdir(full_path):
        raise HTTPException(status_code=404, detail=f"Directory not found: {dir_path}")
    items = []
    for name in sorted(os.listdir(full_path)):
        if name.startswith(".") or name == "node_modules" or name == "__pycache__":
            continue
        item_path = os.path.join(full_path, name)
        items.append({
            "name": name,
            "type": "dir" if os.path.isdir(item_path) else "file",
            "path": os.path.join(dir_path, name) if dir_path else name,
            "size": os.path.getsize(item_path) if os.path.isfile(item_path) else 0,
        })
    return {"path": dir_path, "files": items}


@api_router.post("/code/write")
async def write_code_file(update: CodeUpdate):
    """Write a file, commit, and push to GitHub. Railway auto-deploys backend."""
    full_path = os.path.join(REPO_DIR, update.file_path)
    # Ensure directory exists
    os.makedirs(os.path.dirname(full_path), exist_ok=True)
    try:
        with open(full_path, "w") as f:
            f.write(update.content)

        # Git add, commit, push
        result = subprocess.run(
            f'cd {REPO_DIR} && git add "{update.file_path}" && git commit -m "{update.commit_message}" && git push origin main',
            shell=True, capture_output=True, text=True, timeout=30
        )
        pushed = result.returncode == 0
        return {
            "status": "pushed" if pushed else "committed_locally",
            "file": update.file_path,
            "message": update.commit_message,
            "git_output": (result.stdout + result.stderr)[-300:],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@api_router.post("/code/update")
async def multi_code_update(update: MultiCodeUpdate):
    """Write multiple files, commit all at once, push, optionally trigger EAS build."""
    written = []
    for file_update in update.files:
        full_path = os.path.join(REPO_DIR, file_update.file_path)
        os.makedirs(os.path.dirname(full_path), exist_ok=True)
        with open(full_path, "w") as f:
            f.write(file_update.content)
        written.append(file_update.file_path)

    # Git add all, commit, push
    add_files = " ".join(f'"{f}"' for f in written)
    result = subprocess.run(
        f'cd {REPO_DIR} && git add {add_files} && git commit -m "{update.commit_message}" && git push origin main',
        shell=True, capture_output=True, text=True, timeout=30
    )
    pushed = result.returncode == 0

    build_result = None
    if update.trigger_build:
        build_result = await trigger_eas_build_internal()

    return {
        "status": "pushed" if pushed else "commit_failed",
        "files_updated": written,
        "message": update.commit_message,
        "git_output": (result.stdout + result.stderr)[-300:],
        "build": build_result,
    }


@api_router.post("/build/trigger")
async def trigger_eas_build_endpoint():
    """Trigger an EAS build for iOS and submit to TestFlight."""
    return await trigger_eas_build_internal()


async def trigger_eas_build_internal():
    """Internal: trigger EAS build + TestFlight submit."""
    try:
        result = subprocess.run(
            ["npx", "eas", "build", "--platform", "ios", "--profile", "production", "--non-interactive"],
            capture_output=True, text=True, timeout=600, cwd="/app/frontend"
        )
        build_output = result.stdout + result.stderr
        build_url = None
        for line in build_output.split("\n"):
            if "expo.dev/artifacts" in line:
                build_url = line.strip()

        submitted = False
        if result.returncode == 0:
            submit = subprocess.run(
                ["npx", "eas", "submit", "--platform", "ios", "--latest", "--non-interactive"],
                capture_output=True, text=True, timeout=600, cwd="/app/frontend"
            )
            submitted = submit.returncode == 0

        return {
            "status": "success" if result.returncode == 0 else "build_failed",
            "build_url": build_url,
            "submitted_to_testflight": submitted,
            "log": build_output[-500:],
        }
    except subprocess.TimeoutExpired:
        return {"status": "timeout", "message": "Build timed out"}
    except Exception as e:
        return {"status": "error", "message": str(e)}


# ─── Legacy Routes ─────────────────────────────────────────────────
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
# v2.2.0 - File upload + Device integrations
