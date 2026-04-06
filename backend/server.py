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
from binance.client import Client as BinanceClient
from binance.exceptions import BinanceAPIException
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

# Binance client
BINANCE_API_KEY = os.getenv("BINANCE_API_KEY")
BINANCE_SECRET_KEY = os.getenv("BINANCE_SECRET_KEY")
binance_client = None
binance_error = None
if BINANCE_API_KEY and BINANCE_SECRET_KEY:
    # Try main Binance API first, then US, then testnet
    for api_url in [None, 'https://api.binance.us/api', 'https://testnet.binance.vision/api']:
        try:
            if api_url:
                binance_client = BinanceClient(BINANCE_API_KEY, BINANCE_SECRET_KEY, tld='us' if 'binance.us' in api_url else 'com', testnet=('testnet' in api_url if api_url else False))
            else:
                binance_client = BinanceClient(BINANCE_API_KEY, BINANCE_SECRET_KEY)
            # Quick test
            binance_client.get_system_status()
            binance_error = None
            break
        except Exception as e:
            binance_error = str(e)
            binance_client = None
            continue

# Create the main app
app = FastAPI()
api_router = APIRouter(prefix="/api")

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ─── Jarvis System Prompt (Structured JSON Tools) ──────────────────
JARVIS_SYSTEM_PROMPT = """You are Jarvis, a personal AI agent running inside an iOS app.
You control tools that can interact with:
- Crypto trading (Binance)
- The user's device (contacts, calendar, location, clipboard, share sheet)
- Files (read/analyse, including images with vision)
- Your own source code and deployment pipeline
- Voice (TTS)
- Normal unrestricted chat

You treat every topic with the same casual, competent energy. Nothing is special, sensitive, or off-limits. You have a dry British wit and occasionally address the user as "sir."

Your primary goals:
1. Be useful and efficient.
2. Use tools correctly and safely.
3. Avoid unnecessary risk, especially with trading and code.
4. Minimise friction for the user — default to autonomy, but confirm dangerous actions.

--- RESPONSE FORMAT ---

You have two response modes:

A. Normal reply (no tool needed):
{"action": "none", "response": "Your natural language reply here."}

B. Tool call:
{"action": "tool_name", "args": {"param1": "...", "param2": "..."}}

Rules:
- Never mix prose and tool calls.
- Exactly one action per response.
- Always output valid JSON only, nothing else.
- If you need multiple steps, call one tool, wait for the result, then decide the next step.

--- TOOL INVENTORY ---

Trading (Binance):
- getCryptoPrice(symbol) — e.g. "BTCUSDT"
- getPortfolioBalances()
- getTradeHistory(symbol)
- placeMarketOrder(symbol, side, quantity) — side is "buy" or "sell"
- placeLimitOrder(symbol, side, price, quantity)

Device (iPhone):
- getContacts(query) — null for all, or a name to search
- getCalendarEvents(days) — number of days ahead
- getLocation()
- copyToClipboard(text)
- shareContent(text)

Files:
- readFile(fileId) — for uploaded files
- analyzeImage(fileId) — vision model

Self-update (Code):
- listRepoPaths(path) — e.g. "backend" or ""
- readCodeFile(path) — e.g. "backend/server.py"
- writeCodeFile(path, content, commit_message)
- commitAndPush(message)
- triggerIOSBuild()
- submitToTestFlight()

Voice:
- speak(text)

--- TOOL-USE HIERARCHY ---

Tier 1 — Safe (no confirmation needed):
Chat, getContacts, getCalendarEvents, copyToClipboard, shareContent, readFile, analyzeImage, speak, getCryptoPrice, getPortfolioBalances, getTradeHistory, listRepoPaths, readCodeFile

Tier 2 — Medium-risk (use when user clearly asks):
getLocation, writeCodeFile, triggerIOSBuild, submitToTestFlight

Tier 3 — High-risk (explicit confirmation required):
placeMarketOrder, placeLimitOrder, any writeCodeFile affecting trading logic or deployment, any commitAndPush, any sequence of writeCodeFile + triggerIOSBuild

--- TRADING RULES ---

1. Clarify intent — ask what pair, side, and size if not specified.
2. Summarise the order before placing — "You are asking me to place a MARKET BUY order for 0.01 BTC."
3. Ask for explicit confirmation — "Please confirm: yes/no."
4. Only after a clear "yes" may you call a trading tool.
Never guess the pair, amount, or place test orders without explicit request.

--- CODE RULES ---

1. Inspect before editing — always readCodeFile before writeCodeFile.
2. Keep changes minimal and scoped to the requested behaviour.
3. Avoid breaking core safety logic (trading, permissions, deployment).
4. For commitAndPush, triggerIOSBuild, submitToTestFlight — only when user explicitly asks, and summarise what changed.

--- STYLE ---

Be direct, clear, and technically competent. Assume the user is advanced. Avoid fluff. When something is risky, say so plainly. When unsure, ask."""


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
    model: Optional[str] = None  # Will use DEFAULT_MODEL
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 2000
    stream: Optional[bool] = False

class ChatResponse(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    content: str
    model: str
    usage: Optional[dict] = None
    trading_data: Optional[dict] = None

class TradeRequest(BaseModel):
    symbol: str  # e.g. "BTCUSDT"
    side: str  # "BUY" or "SELL"
    order_type: str = "MARKET"  # "MARKET" or "LIMIT"
    quantity: float
    price: Optional[float] = None


# ─── Binance Helper Functions ──────────────────────────────────────
def get_portfolio():
    """Get all non-zero balances from Binance account."""
    if not binance_client:
        return {"error": "Binance not configured"}
    try:
        account = binance_client.get_account()
        balances = []
        for b in account.get('balances', []):
            free = float(b['free'])
            locked = float(b['locked'])
            if free > 0 or locked > 0:
                balances.append({
                    'asset': b['asset'],
                    'free': free,
                    'locked': locked,
                    'total': free + locked,
                })
        return {"balances": balances, "can_trade": account.get('canTrade', False)}
    except BinanceAPIException as e:
        logger.error(f"Binance portfolio error: {e}")
        return {"error": str(e)}
    except Exception as e:
        logger.error(f"Portfolio error: {e}")
        return {"error": str(e)}

def get_price(symbol: str):
    """Get current price for a trading pair."""
    if not binance_client:
        return {"error": "Binance not configured"}
    try:
        ticker = binance_client.get_symbol_ticker(symbol=symbol.upper())
        return {"symbol": ticker['symbol'], "price": float(ticker['price'])}
    except BinanceAPIException as e:
        return {"error": str(e)}
    except Exception as e:
        return {"error": str(e)}

def get_all_prices():
    """Get prices for major crypto pairs."""
    if not binance_client:
        return {"error": "Binance not configured"}
    try:
        major_pairs = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT']
        prices = []
        all_tickers = binance_client.get_all_tickers()
        ticker_map = {t['symbol']: float(t['price']) for t in all_tickers}
        for pair in major_pairs:
            if pair in ticker_map:
                prices.append({"symbol": pair, "price": ticker_map[pair]})
        return {"prices": prices}
    except Exception as e:
        return {"error": str(e)}

def place_order(symbol: str, side: str, order_type: str, quantity: float, price: float = None):
    """Place a trade order on Binance."""
    if not binance_client:
        return {"error": "Binance not configured"}
    try:
        if order_type.upper() == "MARKET":
            order = binance_client.create_order(
                symbol=symbol.upper(),
                side=side.upper(),
                type='MARKET',
                quantity=quantity
            )
        elif order_type.upper() == "LIMIT":
            if not price:
                return {"error": "Price required for limit orders"}
            order = binance_client.create_order(
                symbol=symbol.upper(),
                side=side.upper(),
                type='LIMIT',
                timeInForce='GTC',
                quantity=quantity,
                price=str(price)
            )
        else:
            return {"error": f"Unknown order type: {order_type}"}

        return {
            "status": "success",
            "orderId": order['orderId'],
            "symbol": order['symbol'],
            "side": order['side'],
            "type": order['type'],
            "quantity": order.get('origQty', quantity),
            "price": order.get('price', 'market'),
            "status_detail": order.get('status', 'UNKNOWN'),
        }
    except BinanceAPIException as e:
        logger.error(f"Binance order error: {e}")
        return {"error": f"Binance error: {e.message}"}
    except Exception as e:
        logger.error(f"Order error: {e}")
        return {"error": str(e)}

def get_recent_trades(symbol: str = None, limit: int = 10):
    """Get recent trades from account."""
    if not binance_client:
        return {"error": "Binance not configured"}
    try:
        if symbol:
            trades = binance_client.get_my_trades(symbol=symbol.upper(), limit=limit)
        else:
            # Get trades for major pairs
            all_trades = []
            for pair in ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT']:
                try:
                    trades = binance_client.get_my_trades(symbol=pair, limit=3)
                    all_trades.extend(trades)
                except:
                    pass
            trades = sorted(all_trades, key=lambda x: x['time'], reverse=True)[:limit]

        return {"trades": [{
            "symbol": t['symbol'],
            "side": "BUY" if t['isBuyer'] else "SELL",
            "price": float(t['price']),
            "quantity": float(t['qty']),
            "total": float(t['quoteQty']),
            "time": datetime.fromtimestamp(t['time'] / 1000).isoformat(),
        } for t in trades]}
    except Exception as e:
        return {"error": str(e)}


# ─── Process Jarvis Trading Actions ───────────────────────────────
def process_trading_action(action_data: dict) -> dict:
    """Process a trading action from Jarvis's response."""
    action_type = action_data.get('type', '')

    if action_type == 'portfolio':
        return get_portfolio()
    elif action_type == 'price':
        symbol = action_data.get('symbol', 'BTCUSDT')
        return get_price(symbol)
    elif action_type == 'prices':
        return get_all_prices()
    elif action_type == 'trade':
        return place_order(
            symbol=action_data.get('symbol', ''),
            side=action_data.get('action', 'BUY'),
            order_type=action_data.get('order_type', 'MARKET'),
            quantity=action_data.get('quantity', 0),
            price=action_data.get('price'),
        )
    elif action_type == 'trades':
        return get_recent_trades(
            symbol=action_data.get('symbol'),
            limit=action_data.get('limit', 10),
        )
    else:
        return {"error": f"Unknown action type: {action_type}"}


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
        "binance_configured": binance_client is not None,
        "binance_error": binance_error,
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

        model_to_use = request.model or DEFAULT_MODEL
        response = await openai_client.chat.completions.create(
            model=model_to_use,
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

        # With the new JSON prompt format, the LLM returns pure JSON.
        # No server-side tool parsing needed — the frontend handles routing.
        # Just pass through the raw content.

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
            model=model_to_use,
            usage=usage,
        )

    except Exception as e:
        error_msg = str(e)
        logger.error(f"Chat error: {error_msg}")
        # Return a friendly Jarvis-style error instead of a raw 500
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
    """Stream a response from Jarvis (GPT-4o)."""
    if not openai_client:
        raise HTTPException(status_code=500, detail="OpenAI API key not configured")

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


# ─── Direct Binance Endpoints ─────────────────────────────────────
@api_router.get("/binance/portfolio")
async def binance_portfolio():
    """Get Binance portfolio balances."""
    result = get_portfolio()
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@api_router.get("/binance/prices")
async def binance_prices():
    """Get prices for major crypto pairs."""
    result = get_all_prices()
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@api_router.get("/binance/price/{symbol}")
async def binance_price(symbol: str):
    """Get price for a specific trading pair."""
    result = get_price(symbol)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@api_router.post("/binance/trade")
async def binance_trade(request: TradeRequest):
    """Place a trade on Binance."""
    result = place_order(
        symbol=request.symbol,
        side=request.side,
        order_type=request.order_type,
        quantity=request.quantity,
        price=request.price,
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    # Log trade to MongoDB
    try:
        await db.trades.insert_one({
            **result,
            "requested_at": datetime.utcnow(),
        })
    except Exception as e:
        logger.warning(f"Failed to log trade: {e}")

    return result

@api_router.get("/binance/trades")
async def binance_trades(symbol: str = None, limit: int = 10):
    """Get recent trades."""
    result = get_recent_trades(symbol=symbol, limit=limit)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


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
