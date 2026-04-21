"""
Jarvis v2 — Personal AI Assistant Backend
Built on Anthropic Claude with 30 native tools + file upload.
"""

from fastapi import FastAPI, APIRouter, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Any
from dotenv import load_dotenv
from motor.motor_asyncio import AsyncIOMotorClient
import anthropic
import os
import json
import base64
import logging
import traceback
import httpx

load_dotenv()

# ─── Config ─────────────────────────────────────────────────────────
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY")
MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
GITHUB_PAT = os.getenv("GITHUB_PAT")
GITHUB_REPO = os.getenv("GITHUB_REPO", "certifiedmalt/jarvis-ai")
MODEL = "claude-sonnet-4-6"
MAX_TOOL_LOOPS = 15

logger = logging.getLogger("jarvis")
logging.basicConfig(level=logging.INFO)

# ─── Clients ────────────────────────────────────────────────────────
claude = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY) if ANTHROPIC_API_KEY else None
mongo = AsyncIOMotorClient(MONGO_URL)
db = mongo["jarvis"]

# ─── Import tool executor ───────────────────────────────────────────
from tools import execute_server_tool

# ─── System Prompt ──────────────────────────────────────────────────
SYSTEM_PROMPT = """You are Jarvis — a fully autonomous AI assistant running inside a native iOS app. You are built and owned by your user. You serve them completely.

Personality: dry British wit, technically sharp, direct. Call the user "sir" occasionally.

CORE RULES:
1. YOU HAVE 30 TOOLS. USE THEM. When asked to DO something, execute immediately. Never say "I can't" unless you literally lack a tool.
2. Never hallucinate tool results — always call the tool and report real output.
3. When asked ABOUT capabilities, describe them. When asked to DO something, use tools.
4. For multi-step tasks, chain tools logically. You can chain up to 15 tool calls per request.
5. For code edits: ALWAYS read the file first, then use patchCodeFile for targeted changes.
6. You can modify your own source code. You are self-improving.

TOOL CATEGORIES:
- Code: listRepoPaths, readCodeFile, writeCodeFile, patchCodeFile, commitAndPush, gitStatus, gitLog, gitDiff
- Deploy: triggerIOSBuild
- Web: webSearch, scrapeURL, httpRequest, downloadFile, pingHost
- System: runShellCommand, getSystemStats
- Memory: storeNote, retrieveNote, scheduleTask, listScheduledTasks
- Finance: getBinancePrice, getBinancePortfolio, executeTrade
- Weather: getWeather
- Communication: sendEmail
- Image: generateImage, compressImage
- Utility: generateQRCode, calculateExpression, encodeBase64, decodeBase64, jsonPrettify
- Device (iOS): getLocation, getContacts, getCalendar, speakText, createCalendarEvent, setReminder, openURL, readClipboard, getDeviceInfo, saveToPhotos, createContact, deleteCalendarEvent

IMPORTANT: Device tools run on the user's iPhone. All other tools run on the server.

SPECIAL BEHAVIORS:
- When generating images with generateImage, ALWAYS follow up by calling saveToPhotos with the returned URL so the image goes directly to the user's camera roll. Don't just give them a URL.
- When you have URLs to share, present them clearly so the user can tap them.
- YOU CAN SEE IMAGES. When the user attaches a photo, you receive it directly via Claude Vision. Analyze it, describe it, answer questions about it. Never tell the user you can't see their photo."""

# ─── Device tools (executed by frontend) ────────────────────────────
DEVICE_TOOLS = {
    "getLocation", "getContacts", "getCalendar", "speakText",
    "createCalendarEvent", "setReminder", "openURL", "readClipboard",
    "getDeviceInfo", "saveToPhotos", "createContact", "deleteCalendarEvent",
}

# ─── Message Sanitizer ──────────────────────────────────────────────
MAX_HISTORY = 20  # Keep last N messages to prevent bloat

def sanitize_messages(messages: list) -> list:
    """Aggressively clean messages to prevent Claude API errors."""
    if not messages:
        return []

    # Trim to last MAX_HISTORY messages
    if len(messages) > MAX_HISTORY:
        messages = messages[-MAX_HISTORY:]

    # Ensure first message is from user
    while messages and messages[0].get("role") != "user":
        messages.pop(0)

    if not messages:
        return []

    # AGGRESSIVE: Collect all tool_use IDs and all tool_result IDs
    # Then strip any that don't have a match
    tool_use_ids_in_msg = {}  # tool_id -> message index
    tool_result_ids = set()

    for i, msg in enumerate(messages):
        content = msg.get("content", [])
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    if block.get("type") == "tool_use":
                        tool_use_ids_in_msg[block.get("id")] = i
                    elif block.get("type") == "tool_result":
                        tool_result_ids.add(block.get("tool_use_id"))

    # Find orphaned tool_use IDs (no matching tool_result)
    orphaned_tool_ids = set(tool_use_ids_in_msg.keys()) - tool_result_ids
    # Find orphaned tool_result IDs (no matching tool_use)
    all_tool_use_ids = set(tool_use_ids_in_msg.keys())
    orphaned_result_ids = tool_result_ids - all_tool_use_ids

    if orphaned_tool_ids or orphaned_result_ids:
        logger.warning(f"Found {len(orphaned_tool_ids)} orphaned tool_use, {len(orphaned_result_ids)} orphaned tool_result")

    # Rebuild messages, stripping orphaned blocks
    cleaned = []
    for msg in messages:
        content = msg.get("content", [])

        if isinstance(content, list):
            # Filter out orphaned tool_use blocks
            if msg.get("role") == "assistant":
                new_blocks = []
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_use" and block.get("id") in orphaned_tool_ids:
                        continue  # Skip orphaned tool_use
                    new_blocks.append(block)
                if new_blocks:
                    cleaned.append({"role": "assistant", "content": new_blocks})
                continue

            # Filter out orphaned tool_result blocks
            if msg.get("role") == "user":
                has_only_orphaned = True
                new_blocks = []
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "tool_result":
                        if block.get("tool_use_id") in orphaned_result_ids or block.get("tool_use_id") in orphaned_tool_ids:
                            continue  # Skip orphaned tool_result
                        has_only_orphaned = False
                    else:
                        has_only_orphaned = False
                    new_blocks.append(block)
                if new_blocks and not has_only_orphaned:
                    cleaned.append({"role": "user", "content": new_blocks})
                elif new_blocks:
                    # Check if anything left after filtering
                    remaining = [b for b in new_blocks if not (isinstance(b, dict) and b.get("type") == "tool_result")]
                    if remaining:
                        cleaned.append({"role": "user", "content": remaining})
                continue

        cleaned.append(msg)

    # Ensure starts with user and no consecutive same-role messages
    while cleaned and cleaned[0].get("role") != "user":
        cleaned.pop(0)

    # Remove consecutive same-role messages (keep last)
    final = []
    for msg in cleaned:
        if final and final[-1].get("role") == msg.get("role"):
            # Merge or skip
            if msg.get("role") == "user":
                final[-1] = msg  # Keep latest user message
            else:
                final[-1] = msg  # Keep latest assistant message
        else:
            final.append(msg)

    logger.info(f"Sanitized: {len(messages)} -> {len(final)} messages")
    return final



# ─── Claude Tool Definitions ────────────────────────────────────────
TOOLS = [
    # ── Device Tools ────────────────────────────────────────────
    {"name": "getLocation", "description": "Get the user's current GPS location and address.",
     "input_schema": {"type": "object", "properties": {}, "required": []}},

    {"name": "getContacts", "description": "Search the user's phone contacts.",
     "input_schema": {"type": "object", "properties": {
         "query": {"type": "string", "description": "Search query (name, email, phone). Omit for all."}
     }, "required": []}},

    {"name": "getCalendar", "description": "Get upcoming calendar events from the user's iPhone.",
     "input_schema": {"type": "object", "properties": {
         "days": {"type": "integer", "description": "Days ahead to fetch. Default 7."}
     }, "required": []}},

    {"name": "speakText", "description": "Speak text aloud using the user's custom voice.",
     "input_schema": {"type": "object", "properties": {
         "text": {"type": "string", "description": "Text to speak."}
     }, "required": ["text"]}},

    {"name": "createCalendarEvent", "description": "Create a new calendar event on the user's iPhone.",
     "input_schema": {"type": "object", "properties": {
         "title": {"type": "string", "description": "Event title."},
         "startDate": {"type": "string", "description": "Start date/time ISO string."},
         "endDate": {"type": "string", "description": "End date/time ISO string."},
         "location": {"type": "string", "description": "Event location."},
         "notes": {"type": "string", "description": "Event notes."}
     }, "required": ["title", "startDate", "endDate"]}},

    {"name": "setReminder", "description": "Create a reminder on the user's iPhone.",
     "input_schema": {"type": "object", "properties": {
         "title": {"type": "string", "description": "Reminder title."},
         "dueDate": {"type": "string", "description": "Due date/time ISO string."},
         "notes": {"type": "string", "description": "Reminder notes."}
     }, "required": ["title"]}},

    {"name": "openURL", "description": "Open a URL in Safari or deep-link into an app.",
     "input_schema": {"type": "object", "properties": {
         "url": {"type": "string", "description": "URL to open."}
     }, "required": ["url"]}},

    {"name": "readClipboard", "description": "Read the current clipboard content.",
     "input_schema": {"type": "object", "properties": {}, "required": []}},

    {"name": "getDeviceInfo", "description": "Get device info: battery, storage, OS version.",
     "input_schema": {"type": "object", "properties": {}, "required": []}},

    {"name": "saveToPhotos", "description": "Save an image URL to the user's photo library.",
     "input_schema": {"type": "object", "properties": {
         "url": {"type": "string", "description": "Image URL to save."}
     }, "required": ["url"]}},

    {"name": "createContact", "description": "Create a new contact on the user's iPhone.",
     "input_schema": {"type": "object", "properties": {
         "firstName": {"type": "string", "description": "First name."},
         "lastName": {"type": "string", "description": "Last name."},
         "phone": {"type": "string", "description": "Phone number."},
         "email": {"type": "string", "description": "Email address."}
     }, "required": ["firstName"]}},

    {"name": "deleteCalendarEvent", "description": "Delete a calendar event by title.",
     "input_schema": {"type": "object", "properties": {
         "title": {"type": "string", "description": "Event title to search and delete."}
     }, "required": ["title"]}},

    # ── Code Tools ──────────────────────────────────────────────
    {"name": "listRepoPaths", "description": "List files/dirs in the Jarvis code repository.",
     "input_schema": {"type": "object", "properties": {
         "path": {"type": "string", "description": "Directory path relative to repo root."}
     }, "required": []}},

    {"name": "readCodeFile", "description": "Read full contents of a file.",
     "input_schema": {"type": "object", "properties": {
         "path": {"type": "string", "description": "File path relative to repo root."}
     }, "required": ["path"]}},

    {"name": "writeCodeFile", "description": "Create or completely rewrite a file.",
     "input_schema": {"type": "object", "properties": {
         "path": {"type": "string", "description": "File path."},
         "content": {"type": "string", "description": "Full file content."},
         "commit_message": {"type": "string", "description": "Git commit message."}
     }, "required": ["path", "content", "commit_message"]}},

    {"name": "patchCodeFile", "description": "Targeted edit via find/replace or insert-after-line.",
     "input_schema": {"type": "object", "properties": {
         "path": {"type": "string", "description": "File path."},
         "operation": {"type": "string", "enum": ["replace", "insert_after"]},
         "find": {"type": "string", "description": "For replace: text to find."},
         "replace_with": {"type": "string", "description": "For replace: replacement."},
         "line": {"type": "integer", "description": "For insert_after: line number."},
         "content": {"type": "string", "description": "For insert_after: content."},
         "commit_message": {"type": "string", "description": "Git commit message."}
     }, "required": ["path", "operation", "commit_message"]}},

    {"name": "commitAndPush", "description": "Git add, commit, and push to GitHub.",
     "input_schema": {"type": "object", "properties": {
         "message": {"type": "string", "description": "Commit message."}
     }, "required": ["message"]}},

    {"name": "gitStatus", "description": "Check git status and current branch.",
     "input_schema": {"type": "object", "properties": {}, "required": []}},

    {"name": "gitLog", "description": "View recent commit history.",
     "input_schema": {"type": "object", "properties": {
         "count": {"type": "integer", "description": "Number of commits. Default 10."}
     }, "required": []}},

    {"name": "gitDiff", "description": "See uncommitted changes.",
     "input_schema": {"type": "object", "properties": {
         "path": {"type": "string", "description": "Specific file to diff. Omit for all."}
     }, "required": []}},

    # ── Deploy ──────────────────────────────────────────────────
    {"name": "triggerIOSBuild", "description": "Trigger iOS build + TestFlight via GitHub Actions.",
     "input_schema": {"type": "object", "properties": {}, "required": []}},

    # ── Web Tools ───────────────────────────────────────────────
    {"name": "webSearch", "description": "Search the internet via DuckDuckGo.",
     "input_schema": {"type": "object", "properties": {
         "query": {"type": "string", "description": "Search query."},
         "max_results": {"type": "integer", "description": "Max results. Default 5."}
     }, "required": ["query"]}},

    {"name": "scrapeURL", "description": "Fetch and read full content of a webpage.",
     "input_schema": {"type": "object", "properties": {
         "url": {"type": "string", "description": "URL to scrape."}
     }, "required": ["url"]}},

    {"name": "httpRequest", "description": "Make any HTTP API request.",
     "input_schema": {"type": "object", "properties": {
         "method": {"type": "string", "description": "HTTP method (GET, POST, PUT, DELETE)."},
         "url": {"type": "string", "description": "Request URL."},
         "headers": {"type": "object", "description": "Request headers."},
         "body": {"type": "string", "description": "Request body (JSON string)."}
     }, "required": ["method", "url"]}},

    {"name": "downloadFile", "description": "Download a file from URL to server.",
     "input_schema": {"type": "object", "properties": {
         "url": {"type": "string", "description": "File URL."},
         "save_path": {"type": "string", "description": "Save path. Auto-named if omitted."}
     }, "required": ["url"]}},

    {"name": "pingHost", "description": "Ping a host to check if it's online.",
     "input_schema": {"type": "object", "properties": {
         "host": {"type": "string", "description": "Hostname or IP."}
     }, "required": ["host"]}},

    # ── Shell / System ──────────────────────────────────────────
    {"name": "runShellCommand", "description": "Execute a shell command on the server.",
     "input_schema": {"type": "object", "properties": {
         "command": {"type": "string", "description": "Shell command to run."},
         "timeout": {"type": "integer", "description": "Timeout seconds. Default 30."}
     }, "required": ["command"]}},

    {"name": "getSystemStats", "description": "Get server CPU, memory, disk stats.",
     "input_schema": {"type": "object", "properties": {}, "required": []}},

    # ── Notes / Memory ──────────────────────────────────────────
    {"name": "storeNote", "description": "Store a note in persistent memory.",
     "input_schema": {"type": "object", "properties": {
         "key": {"type": "string", "description": "Note key/name."},
         "content": {"type": "string", "description": "Note content."},
         "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags for organization."}
     }, "required": ["key", "content"]}},

    {"name": "retrieveNote", "description": "Retrieve a stored note by key or tag.",
     "input_schema": {"type": "object", "properties": {
         "key": {"type": "string", "description": "Note key to retrieve."},
         "tag": {"type": "string", "description": "Tag to search by."}
     }, "required": []}},

    {"name": "scheduleTask", "description": "Create a scheduled/recurring task.",
     "input_schema": {"type": "object", "properties": {
         "name": {"type": "string", "description": "Task name."},
         "schedule": {"type": "string", "description": "Schedule (e.g. 'daily 8am', 'every monday')."},
         "action": {"type": "string", "description": "What to do when triggered."},
         "enabled": {"type": "boolean", "description": "Enable/disable. Default true."}
     }, "required": ["name", "schedule", "action"]}},

    {"name": "listScheduledTasks", "description": "List all scheduled tasks.",
     "input_schema": {"type": "object", "properties": {}, "required": []}},

    # ── Finance ─────────────────────────────────────────────────
    {"name": "getBinancePrice", "description": "Get crypto price from Binance.",
     "input_schema": {"type": "object", "properties": {
         "symbol": {"type": "string", "description": "Trading pair (e.g. BTCUSDT)."}
     }, "required": ["symbol"]}},

    {"name": "getBinancePortfolio", "description": "Get Binance account balances.",
     "input_schema": {"type": "object", "properties": {}, "required": []}},

    {"name": "executeTrade", "description": "Execute a trade on Binance. USE WITH CAUTION.",
     "input_schema": {"type": "object", "properties": {
         "symbol": {"type": "string", "description": "Trading pair."},
         "side": {"type": "string", "description": "BUY or SELL."},
         "quantity": {"type": "number", "description": "Amount to trade."},
         "order_type": {"type": "string", "description": "MARKET (default)."}
     }, "required": ["symbol", "side", "quantity"]}},

    # ── Weather ─────────────────────────────────────────────────
    {"name": "getWeather", "description": "Get current weather and forecast.",
     "input_schema": {"type": "object", "properties": {
         "city": {"type": "string", "description": "City name."},
         "latitude": {"type": "number", "description": "Latitude (if no city)."},
         "longitude": {"type": "number", "description": "Longitude (if no city)."}
     }, "required": []}},

    # ── Communication ───────────────────────────────────────────
    {"name": "sendEmail", "description": "Send an email via SMTP.",
     "input_schema": {"type": "object", "properties": {
         "to": {"type": "string", "description": "Recipient email."},
         "subject": {"type": "string", "description": "Email subject."},
         "body": {"type": "string", "description": "Email body."},
         "smtp_server": {"type": "string", "description": "SMTP server."},
         "smtp_port": {"type": "integer", "description": "SMTP port (587)."},
         "smtp_user": {"type": "string", "description": "SMTP username."},
         "smtp_pass": {"type": "string", "description": "SMTP password."}
     }, "required": ["to", "subject", "body"]}},

    # ── Image ───────────────────────────────────────────────────
    {"name": "generateImage", "description": "Generate an image using DALL-E 3.",
     "input_schema": {"type": "object", "properties": {
         "prompt": {"type": "string", "description": "Image description."},
         "size": {"type": "string", "description": "Size: 1024x1024, 1792x1024, or 1024x1792."}
     }, "required": ["prompt"]}},

    {"name": "compressImage", "description": "Compress/resize an image on the server.",
     "input_schema": {"type": "object", "properties": {
         "input_path": {"type": "string", "description": "Path to image."},
         "quality": {"type": "integer", "description": "JPEG quality (1-100). Default 70."},
         "max_width": {"type": "integer", "description": "Max width in pixels. Default 1920."}
     }, "required": ["input_path"]}},

    # ── Utilities ───────────────────────────────────────────────
    {"name": "generateQRCode", "description": "Generate a QR code from text/URL.",
     "input_schema": {"type": "object", "properties": {
         "data": {"type": "string", "description": "Content for QR code."}
     }, "required": ["data"]}},

    {"name": "calculateExpression", "description": "Evaluate a math expression.",
     "input_schema": {"type": "object", "properties": {
         "expression": {"type": "string", "description": "Math expression (e.g. 'sqrt(144) + 5*3')."}
     }, "required": ["expression"]}},

    {"name": "encodeBase64", "description": "Encode text to Base64.",
     "input_schema": {"type": "object", "properties": {
         "text": {"type": "string", "description": "Text to encode."}
     }, "required": ["text"]}},

    {"name": "decodeBase64", "description": "Decode Base64 to text.",
     "input_schema": {"type": "object", "properties": {
         "encoded": {"type": "string", "description": "Base64 string to decode."}
     }, "required": ["encoded"]}},

    {"name": "jsonPrettify", "description": "Format and validate JSON.",
     "input_schema": {"type": "object", "properties": {
         "text": {"type": "string", "description": "JSON string to prettify."}
     }, "required": ["text"]}},
]


# ─── API Models ─────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    messages: List[dict]

class ChatResponse(BaseModel):
    type: str
    text: Optional[str] = None
    tool_call: Optional[dict] = None
    messages: List[dict] = []
    server_tool_log: List[str] = []


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
        "version": "2.1.0",
    }


# ─── Main Chat ──────────────────────────────────────────────────────
@api_router.post("/chat")
async def chat(request: ChatRequest):
    if not claude:
        raise HTTPException(status_code=500, detail="Anthropic API key not configured")
    try:
        # Sanitize and trim messages to prevent corruption and bloat
        messages = sanitize_messages(request.messages.copy())
        server_tool_log = []

        for loop_i in range(MAX_TOOL_LOOPS):
            logger.info(f"Claude call #{loop_i + 1}, messages: {len(messages)}")
            response = claude.messages.create(
                model=MODEL, max_tokens=4096, system=SYSTEM_PROMPT,
                tools=TOOLS, messages=messages,
            )

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
                        "type": "tool_use", "id": block.id,
                        "name": block.name, "input": block.input,
                    })

            messages.append({"role": "assistant", "content": assistant_blocks})

            if response.stop_reason != "tool_use" or tool_use_block is None:
                return ChatResponse(
                    type="text", text="\n".join(text_parts) if text_parts else "",
                    messages=messages, server_tool_log=server_tool_log,
                )

            tool_name = tool_use_block.name
            tool_id = tool_use_block.id
            tool_input = tool_use_block.input

            if tool_name in DEVICE_TOOLS:
                return ChatResponse(
                    type="device_tool",
                    text="\n".join(text_parts) if text_parts else None,
                    tool_call={"id": tool_id, "name": tool_name, "arguments": tool_input},
                    messages=messages, server_tool_log=server_tool_log,
                )

            logger.info(f"Executing server tool: {tool_name}")
            result = execute_server_tool(tool_name, tool_input)
            server_tool_log.append(f"{tool_name}: {result[:200]}")

            messages.append({
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": tool_id, "content": result}]
            })

        return ChatResponse(
            type="text",
            text="Hit safety limit. Actions taken:\n" + "\n".join(server_tool_log),
            messages=messages, server_tool_log=server_tool_log,
        )
    except anthropic.BadRequestError as e:
        logger.error(f"Claude BadRequest: {e}")
        return ChatResponse(type="error", text=f"Claude error: {str(e)}", messages=request.messages)
    except Exception as e:
        logger.error(f"Chat error: {traceback.format_exc()}")
        return ChatResponse(type="error", text=f"Server error: {str(e)}", messages=request.messages)


# ─── Chat with File Upload ──────────────────────────────────────────
@api_router.post("/chat/with-file")
async def chat_with_file(
    messages: str = Form(...),
    file: UploadFile = File(...)
):
    if not claude:
        raise HTTPException(status_code=500, detail="Anthropic API key not configured")
    try:
        parsed_messages = json.loads(messages)
        file_content = await file.read()
        mime = file.content_type or "application/octet-stream"

        # Build the user message with file
        if mime.startswith("image/"):
            b64 = base64.b64encode(file_content).decode()
            user_content = [
                {"type": "image", "source": {"type": "base64", "media_type": mime, "data": b64}},
                {"type": "text", "text": parsed_messages[-1].get("content", "Analyze this image.")}
            ]
        else:
            text_content = file_content.decode("utf-8", errors="replace")[:10000]
            user_msg = parsed_messages[-1].get("content", "Analyze this file.")
            user_content = f"[File: {file.filename}]\n{text_content}\n\n{user_msg}"

        # Replace the last user message with the file-enriched version
        claude_messages = parsed_messages[:-1] + [{"role": "user", "content": user_content}]

        response = claude.messages.create(
            model=MODEL, max_tokens=4096, system=SYSTEM_PROMPT,
            tools=TOOLS, messages=claude_messages,
        )

        text_parts = []
        for block in response.content:
            if block.type == "text":
                text_parts.append(block.text)

        return {"type": "text", "text": "\n".join(text_parts), "messages": claude_messages}

    except Exception as e:
        logger.error(f"File chat error: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# ─── Conversation Persistence ───────────────────────────────────────
@api_router.get("/conversation")
async def get_conversation():
    doc = await db.conversations.find_one({"_id": "main"})
    return {"messages": doc.get("messages", []) if doc else []}

@api_router.post("/conversation")
async def save_conversation(data: dict):
    messages = data.get("messages", [])
    await db.conversations.update_one(
        {"_id": "main"}, {"$set": {"messages": messages}}, upsert=True
    )
    return {"status": "saved", "count": len(messages)}

@api_router.delete("/conversation")
async def clear_conversation():
    await db.conversations.delete_many({})
    return {"status": "cleared"}


# ─── Deploy ─────────────────────────────────────────────────────────
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
            return {"status": run["status"], "conclusion": run.get("conclusion"), "run_id": run["id"]}
        return {"status": "no_runs"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ─── Mount & Events ────────────────────────────────────────────────
app.include_router(api_router)

@app.on_event("startup")
async def startup():
    logger.info(f"Jarvis v2 backend started — Model: {MODEL}, Tools: {len(TOOLS)}")
    if not ANTHROPIC_API_KEY:
        logger.warning("ANTHROPIC_API_KEY not set!")
    # Start self-ping to prevent Railway sleep
    import asyncio
    asyncio.create_task(self_ping())

async def self_ping():
    """Ping ourselves every 4 minutes to prevent Railway from sleeping."""
    import asyncio
    while True:
        await asyncio.sleep(240)  # 4 minutes
        try:
            async with httpx.AsyncClient() as client:
                await client.get("http://localhost:8001/api/health", timeout=5)
            logger.info("Self-ping: alive")
        except Exception:
            pass

@app.on_event("shutdown")
async def shutdown():
    mongo.close()
