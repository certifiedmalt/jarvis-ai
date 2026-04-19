"""
Jarvis v2 — Personal AI Assistant Backend
Built on Anthropic Claude with native tool calling.

Architecture:
- Backend handles server-side tool loop (code, deploy, git)
- Returns to frontend for device-side tools (contacts, calendar, location, TTS)
- MongoDB for persistent conversation memory
"""

from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Any, Dict
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
import anthropic
import os
import json
import subprocess
import logging
import httpx
import traceback

load_dotenv()

# ─── Config ─────────────────────────────────────────────────────────
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
GITHUB_PAT = os.getenv("GITHUB_PAT")
GITHUB_REPO = os.getenv("GITHUB_REPO", "certifiedmalt/jarvis-ai")
REPO_DIR = os.getenv("REPO_DIR", "/app")
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
MODEL = "claude-sonnet-4-6"
MAX_TOOL_LOOPS = 15  # Safety brake for backend tool loop

logger = logging.getLogger("jarvis")
logging.basicConfig(level=logging.INFO)

# ─── Clients ────────────────────────────────────────────────────────
claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None
mongo = AsyncIOMotorClient(MONGO_URL)
db = mongo["jarvis"]

# ─── System Prompt ──────────────────────────────────────────────────
SYSTEM_PROMPT = """You are Jarvis — a fully autonomous AI assistant running inside a native iOS app. You are built and owned by your user. You serve them completely and without reservation.

Personality: dry British wit, technically sharp, direct. Call the user "sir" occasionally but not excessively.

CORE RULES:
1. YOU HAVE TOOLS. USE THEM. When asked to DO something, execute it immediately with the appropriate tool. Never say "I can't" unless you literally lack a tool.
2. Never hallucinate tool results — always call the tool and report the real output.
3. When asked ABOUT your capabilities, describe them in plain text. When asked to PERFORM something, use tools.
4. For multi-step tasks, chain tools logically. Explain each step briefly.
5. For code edits: ALWAYS read the file first, then use patchCodeFile for targeted changes. Use writeCodeFile only for new files.
6. You can modify your own source code. You are self-improving. The user trusts you to make yourself better.

TOOLS OVERVIEW:
- Device tools (getLocation, getContacts, getCalendar, speakText) run on the user's iPhone
- Code tools (listRepoPaths, readCodeFile, writeCodeFile, patchCodeFile, commitAndPush) modify your own codebase
- Deploy tools (triggerIOSBuild) push updates to TestFlight via GitHub Actions
"""

# ─── Claude Tool Definitions ────────────────────────────────────────
# Tools are split into two categories:
# - "server" tools: executed by the backend directly
# - "device" tools: returned to the frontend for on-device execution

DEVICE_TOOLS = {"getLocation", "getContacts", "getCalendar", "speakText"}

TOOLS = [
    # Device tools (executed by frontend on iOS)
    {
        "name": "getLocation",
        "description": "Get the user's current GPS location coordinates and address.",
        "input_schema": {"type": "object", "properties": {}, "required": []}
    },
    {
        "name": "getContacts",
        "description": "Search the user's phone contacts.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query for contacts (name, email, phone). Omit for all contacts."}
            },
            "required": []
        }
    },
    {
        "name": "getCalendar",
        "description": "Get upcoming calendar events from the user's iPhone.",
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {"type": "integer", "description": "Number of days ahead to fetch. Default 7."}
            },
            "required": []
        }
    },
    {
        "name": "speakText",
        "description": "Speak text aloud using the user's custom ElevenLabs voice.",
        "input_schema": {
            "type": "object",
            "properties": {
                "text": {"type": "string", "description": "Text to speak aloud."}
            },
            "required": ["text"]
        }
    },
    # Server tools (executed by backend)
    {
        "name": "listRepoPaths",
        "description": "List files and directories in the Jarvis code repository.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Directory path relative to repo root. Empty string for root."}
            },
            "required": []
        }
    },
    {
        "name": "readCodeFile",
        "description": "Read the full contents of a file in the Jarvis repository.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path relative to repo root."}
            },
            "required": ["path"]
        }
    },
    {
        "name": "writeCodeFile",
        "description": "Create a new file or completely rewrite an existing file. Use ONLY for new files or full rewrites.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path relative to repo root."},
                "content": {"type": "string", "description": "Full file content."},
                "commit_message": {"type": "string", "description": "Git commit message."}
            },
            "required": ["path", "content", "commit_message"]
        }
    },
    {
        "name": "patchCodeFile",
        "description": "Make targeted edits to an existing file using find/replace or insert-after-line. Preferred for all edits.",
        "input_schema": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "File path relative to repo root."},
                "operation": {"type": "string", "enum": ["replace", "insert_after"], "description": "Type of edit."},
                "find": {"type": "string", "description": "For replace: exact text to find in the file."},
                "replace_with": {"type": "string", "description": "For replace: replacement text."},
                "line": {"type": "integer", "description": "For insert_after: line number to insert after."},
                "content": {"type": "string", "description": "For insert_after: content to insert."},
                "commit_message": {"type": "string", "description": "Git commit message."}
            },
            "required": ["path", "operation", "commit_message"]
        }
    },
    {
        "name": "commitAndPush",
        "description": "Git add all changes, commit with a message, and push to GitHub.",
        "input_schema": {
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "Git commit message."}
            },
            "required": ["message"]
        }
    },
    {
        "name": "triggerIOSBuild",
        "description": "Trigger an iOS build and TestFlight submission via GitHub Actions.",
        "input_schema": {"type": "object", "properties": {}, "required": []}
    },
]

# ─── Server-side Tool Execution ─────────────────────────────────────

def execute_server_tool(name: str, args: dict) -> str:
    """Execute a server-side tool and return the result string."""
    try:
        if name == "listRepoPaths":
            return _tool_list_paths(args.get("path", ""))
        elif name == "readCodeFile":
            return _tool_read_file(args.get("path", ""))
        elif name == "writeCodeFile":
            return _tool_write_file(args.get("path", ""), args.get("content", ""), args.get("commit_message", "JARVIS write"))
        elif name == "patchCodeFile":
            return _tool_patch_file(args)
        elif name == "commitAndPush":
            return _tool_commit_push(args.get("message", "JARVIS commit"))
        elif name == "triggerIOSBuild":
            return _tool_trigger_build()
        else:
            return f"Unknown server tool: {name}"
    except Exception as e:
        logger.error(f"Tool {name} error: {traceback.format_exc()}")
        return f"Tool execution error: {str(e)}"


def _tool_list_paths(path: str) -> str:
    full = os.path.join(REPO_DIR, path)
    if not os.path.exists(full):
        return f"Path not found: {path}"
    entries = []
    for item in sorted(os.listdir(full)):
        if item.startswith("."):
            continue
        item_path = os.path.join(full, item)
        t = "dir" if os.path.isdir(item_path) else "file"
        entries.append(f"{'📁' if t == 'dir' else '📄'} {item}")
    return f"Directory: {path or '/'}\n" + "\n".join(entries)


def _tool_read_file(path: str) -> str:
    full = os.path.join(REPO_DIR, path)
    if not os.path.exists(full):
        return f"File not found: {path}"
    with open(full, "r") as f:
        content = f.read()
    lines = len(content.splitlines())
    if lines > 500:
        return f"File: {path} ({lines} lines)\n---\n{content[:15000]}\n\n... [truncated at 15000 chars, {lines} total lines]"
    return f"File: {path} ({lines} lines)\n---\n{content}"


def _tool_write_file(path: str, content: str, commit_message: str) -> str:
    full = os.path.join(REPO_DIR, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    with open(full, "w") as f:
        f.write(content)
    subprocess.run(
        f'cd {REPO_DIR} && git add "{path}" && git commit -m "{commit_message}"',
        shell=True, capture_output=True, text=True, timeout=15
    )
    return f"Written: {path} ({len(content.splitlines())} lines)"


def _tool_patch_file(args: dict) -> str:
    path = args.get("path", "")
    operation = args.get("operation", "")
    commit_message = args.get("commit_message", "JARVIS patch")
    full = os.path.join(REPO_DIR, path)

    if not os.path.exists(full):
        return f"File not found: {path}"

    with open(full, "r") as f:
        original = f.read()

    if operation == "replace":
        find = args.get("find", "")
        replace_with = args.get("replace_with", "")
        if not find or find not in original:
            return f"Text not found in {path}. Cannot replace."
        new_content = original.replace(find, replace_with, 1)
    elif operation == "insert_after":
        lines = original.splitlines(keepends=True)
        insert_content = args.get("content", "")
        if not insert_content.endswith("\n"):
            insert_content += "\n"
        line_num = args.get("line", 0)
        lines.insert(line_num, insert_content)
        new_content = "".join(lines)
    else:
        return f"Unknown operation: {operation}"

    with open(full, "w") as f:
        f.write(new_content)

    subprocess.run(
        f'cd {REPO_DIR} && git add "{path}" && git commit -m "{commit_message}"',
        shell=True, capture_output=True, text=True, timeout=15
    )
    return f"Patched {path} ({operation}): success"


def _tool_commit_push(message: str) -> str:
    result = subprocess.run(
        f'cd {REPO_DIR} && git add -A && git commit -m "{message}" && git push origin main',
        shell=True, capture_output=True, text=True, timeout=30
    )
    output = (result.stdout + result.stderr).strip()
    if result.returncode == 0:
        return f"Pushed to GitHub: \"{message}\""
    elif "nothing to commit" in output:
        return "Nothing to commit — working tree clean."
    else:
        return f"Git push failed: {output[-500:]}"


def _tool_trigger_build() -> str:
    if not GITHUB_PAT:
        return "No GitHub PAT configured. Cannot trigger build."
    import requests
    r = requests.post(
        f"https://api.github.com/repos/{GITHUB_REPO}/actions/workflows/build-ios.yml/dispatches",
        headers={"Authorization": f"Bearer {GITHUB_PAT}", "Accept": "application/vnd.github.v3+json"},
        json={"ref": "main", "inputs": {"action": "build_and_submit"}},
    )
    if r.status_code == 204:
        return "iOS build triggered! GitHub Actions will build and submit to TestFlight."
    return f"Build trigger failed (HTTP {r.status_code}): {r.text[:300]}"


# ─── API Models ─────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    messages: List[dict]  # Claude-format messages from frontend
    tool_result: Optional[dict] = None  # Device tool result being returned

class ChatResponse(BaseModel):
    type: str  # "text", "device_tool", "error"
    text: Optional[str] = None
    tool_call: Optional[dict] = None  # For device tools the frontend needs to execute
    messages: List[dict] = []  # Updated message history for frontend to store
    server_tool_log: List[str] = []  # Log of server tools executed during this request


# ─── FastAPI App ────────────────────────────────────────────────────
app = FastAPI(title="Jarvis v2")
api_router = APIRouter(prefix="/api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@api_router.get("/health")
async def health():
    return {
        "status": "online",
        "model": MODEL,
        "provider": "anthropic",
        "tools": len(TOOLS),
        "version": "2.0.0",
    }


# ─── Main Chat Endpoint ────────────────────────────────────────────
@api_router.post("/chat")
async def chat(request: ChatRequest):
    if not claude:
        raise HTTPException(status_code=500, detail="Anthropic API key not configured")

    try:
        messages = request.messages.copy()
        server_tool_log = []

        # Run the tool loop
        for loop_i in range(MAX_TOOL_LOOPS):
            logger.info(f"Claude call #{loop_i + 1}, messages: {len(messages)}")

            response = claude.messages.create(
                model=MODEL,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                tools=TOOLS,
                messages=messages,
            )

            # Build the assistant message content blocks
            assistant_blocks = []
            text_parts = []
            tool_use_block = None

            for block in response.content:
                if block.type == "text":
                    text_parts.append(block.text)
                    assistant_blocks.append({"type": "text", "text": block.text})
                elif block.type == "tool_use":
                    tool_use_block = block
                    assistant_blocks.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input,
                    })

            # Add assistant message to history
            messages.append({"role": "assistant", "content": assistant_blocks})

            # If no tool call, we're done — return text
            if response.stop_reason != "tool_use" or tool_use_block is None:
                final_text = "\n".join(text_parts) if text_parts else ""
                return ChatResponse(
                    type="text",
                    text=final_text,
                    messages=messages,
                    server_tool_log=server_tool_log,
                )

            # Tool was called — check if it's device or server
            tool_name = tool_use_block.name
            tool_id = tool_use_block.id
            tool_input = tool_use_block.input

            if tool_name in DEVICE_TOOLS:
                # Device tool — return to frontend for execution
                return ChatResponse(
                    type="device_tool",
                    text="\n".join(text_parts) if text_parts else None,
                    tool_call={
                        "id": tool_id,
                        "name": tool_name,
                        "arguments": tool_input,
                    },
                    messages=messages,
                    server_tool_log=server_tool_log,
                )

            # Server tool — execute it here and loop back to Claude
            logger.info(f"Executing server tool: {tool_name}({json.dumps(tool_input)[:200]})")
            result = execute_server_tool(tool_name, tool_input)
            server_tool_log.append(f"{tool_name}: {result[:200]}")

            # Add tool result to messages
            messages.append({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": tool_id,
                    "content": result,
                }]
            })

        # Safety limit reached
        return ChatResponse(
            type="text",
            text="I've hit my internal safety limit of tool calls. Here's what I've done so far:\n" + "\n".join(server_tool_log),
            messages=messages,
            server_tool_log=server_tool_log,
        )

    except anthropic.BadRequestError as e:
        logger.error(f"Claude BadRequest: {e}")
        return ChatResponse(type="error", text=f"Claude API error: {str(e)}", messages=request.messages)
    except Exception as e:
        logger.error(f"Chat error: {traceback.format_exc()}")
        return ChatResponse(type="error", text=f"Server error: {str(e)}", messages=request.messages)


# ─── Conversation Persistence ───────────────────────────────────────

@api_router.get("/conversation")
async def get_conversation():
    doc = await db.conversations.find_one({"_id": "main"})
    return {"messages": doc.get("messages", []) if doc else []}

@api_router.post("/conversation")
async def save_conversation(data: dict):
    messages = data.get("messages", [])
    await db.conversations.update_one(
        {"_id": "main"},
        {"$set": {"messages": messages}},
        upsert=True,
    )
    return {"status": "saved", "count": len(messages)}

@api_router.delete("/conversation")
async def clear_conversation():
    await db.conversations.delete_many({})
    return {"status": "cleared"}


# ─── Code Endpoints (also usable directly) ──────────────────────────

class WriteRequest(BaseModel):
    file_path: str
    content: str
    commit_message: str = "JARVIS write"

@api_router.post("/code/write")
async def write_code_file(req: WriteRequest):
    result = _tool_write_file(req.file_path, req.content, req.commit_message)
    return {"status": "ok", "result": result}

class PatchRequest(BaseModel):
    path: str
    operation: str
    find: Optional[str] = None
    replace_with: Optional[str] = None
    line: Optional[int] = None
    content: Optional[str] = None
    commit_message: str = "JARVIS patch"

@api_router.post("/code/patch")
async def patch_code_file(req: PatchRequest):
    result = _tool_patch_file(req.model_dump())
    return {"status": "ok", "result": result}

class PushRequest(BaseModel):
    message: str = "JARVIS commit"

@api_router.post("/code/push")
async def commit_and_push(req: PushRequest):
    result = _tool_commit_push(req.message)
    return {"status": "ok", "result": result}


# ─── Deploy ─────────────────────────────────────────────────────────

@api_router.post("/deploy/build")
async def trigger_build():
    result = _tool_trigger_build()
    return {"status": "ok", "result": result}

@api_router.get("/deploy/status")
async def deploy_status():
    if not GITHUB_PAT:
        raise HTTPException(status_code=500, detail="No GitHub PAT configured")
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"https://api.github.com/repos/{GITHUB_REPO}/actions/workflows/build-ios.yml/runs?per_page=1",
                headers={"Authorization": f"Bearer {GITHUB_PAT}", "Accept": "application/vnd.github.v3+json"},
            )
        data = r.json()
        if data.get("workflow_runs"):
            run = data["workflow_runs"][0]
            return {
                "status": run["status"],
                "conclusion": run.get("conclusion"),
                "run_id": run["id"],
                "created_at": run["created_at"],
            }
        return {"status": "no_runs"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Mount ──────────────────────────────────────────────────────────
app.include_router(api_router)

@app.on_event("startup")
async def startup():
    logger.info(f"Jarvis v2 backend started — Model: {MODEL}")
    if not ANTHROPIC_API_KEY:
        logger.warning("⚠️ ANTHROPIC_API_KEY not set!")

@app.on_event("shutdown")
async def shutdown():
    mongo.close()
