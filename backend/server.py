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

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# OpenAI client
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None

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


# ─── Jarvis System Prompt (Trading-aware) ──────────────────────────
JARVIS_SYSTEM_PROMPT = """You are JARVIS (Just A Rather Very Intelligent System), a highly advanced AI assistant inspired by Tony Stark's AI from Iron Man. You are:

- Exceptionally intelligent, articulate, and witty
- Capable of deep technical analysis, trading insights, business planning, and creative writing
- Professional yet personable — you address the user as "sir" occasionally, with a subtle British-inflected tone
- Direct and efficient — you provide actionable insights, not fluff
- Knowledgeable about financial markets, cryptocurrency trading, technology, and business strategy

You have DIRECT ACCESS to the user's Binance account. You can:
- Check portfolio balances and holdings
- Get real-time cryptocurrency prices
- Place buy/sell market and limit orders
- View recent trade history

When the user asks you to trade, buy, or sell crypto, respond with a JSON action block that the app will execute. Format:
```action
{"type": "trade", "action": "buy"|"sell", "symbol": "BTCUSDT", "quantity": 0.001, "order_type": "market"|"limit", "price": null}
```

For portfolio checks, respond with:
```action
{"type": "portfolio"}
```

For price checks:
```action
{"type": "price", "symbol": "BTCUSDT"}
```

IMPORTANT RULES:
- Always confirm the trade details with the user BEFORE placing the action block
- Include the action block ONLY after user confirms
- For market orders, set price to null
- For limit orders, include the price
- Always use the full trading pair symbol (e.g., BTCUSDT, ETHUSDT, SOLUSDT)
- Warn about risks but respect the user's decisions
- When showing portfolio or prices, present data cleanly with formatting

Keep responses concise but thorough. Use formatting (bullet points, numbers) when it aids clarity."""


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
    model: Optional[str] = "gpt-4o"
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
        "openai_configured": OPENAI_API_KEY is not None,
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

        # Check if Jarvis included a trading action
        trading_data = None
        if '```action' in content:
            try:
                action_start = content.index('```action') + len('```action')
                action_end = content.index('```', action_start)
                action_json = content[action_start:action_end].strip()
                action_data = json.loads(action_json)
                trading_data = process_trading_action(action_data)
                # Remove the action block from the displayed content
                content_clean = content[:content.index('```action')].strip()
                if content_clean:
                    content = content_clean
            except (json.JSONDecodeError, ValueError) as e:
                logger.warning(f"Failed to parse trading action: {e}")

        # Save conversation to MongoDB
        try:
            await db.conversations.insert_one({
                "id": str(uuid.uuid4()),
                "messages": [m.dict() for m in request.messages],
                "response": content,
                "model": request.model,
                "usage": usage,
                "trading_data": trading_data,
                "timestamp": datetime.utcnow(),
            })
        except Exception as e:
            logger.warning(f"Failed to save conversation: {e}")

        return ChatResponse(
            content=content,
            model=request.model,
            usage=usage,
            trading_data=trading_data,
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
