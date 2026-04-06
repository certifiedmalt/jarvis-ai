# Jarvis AI - Product Requirements Document

## Overview
Jarvis is a standalone AI assistant mobile app (Expo/React Native) inspired by Iron Man's JARVIS. It uses GPT-4o for intelligent chat and has direct Binance trading integration.

## Architecture
- **Frontend**: Expo React Native (iOS + Android + Web)
- **Backend**: FastAPI (Python)
- **Database**: MongoDB
- **AI**: OpenAI GPT-4o (user's own key, no Emergent dependency)
- **Trading**: Binance API (python-binance)

## Core Features

### ✅ Implemented
1. **GPT-4o Chat** — Jarvis personality with JARVIS system prompt, conversation context
2. **Binance Trading Backend** — Portfolio view, price checks, market/limit orders, trade history
3. **AI-Powered Trading** — Jarvis understands natural language trading commands and generates action blocks
4. **Trading Data Cards** — Rich UI cards for portfolio, prices, trade confirmations, errors
5. **Conversation Storage** — All chats saved to MongoDB
6. **Health Monitoring** — Health endpoint with OpenAI + Binance status

### 🔜 Upcoming
1. Enable Spot Trading on Binance API key (user needs to update permissions)
2. Deploy backend to user's own server (Railway) to avoid Binance geo-restrictions
3. Push to TestFlight for iPhone testing
4. Secure on-device API key storage (SecureStore)

### 🔮 Future
1. Book Writing assistant mode
2. Business Planning assistant mode
3. Automated trading strategies
4. Re-evaluate on-device LLMs when libraries mature

## API Endpoints
- `GET /api/health` — System health check
- `POST /api/chat` — Chat with Jarvis (GPT-4o + trading actions)
- `POST /api/chat/stream` — Streaming chat response
- `GET /api/binance/portfolio` — Portfolio balances
- `GET /api/binance/prices` — Major crypto prices
- `GET /api/binance/price/{symbol}` — Specific pair price
- `POST /api/binance/trade` — Place a trade
- `GET /api/binance/trades` — Recent trade history

## Known Limitations
- Binance API blocked from Emergent cloud server (geo-restriction) — works on Railway/user's server
- Binance API key currently read-only (user needs to enable Spot Trading)
