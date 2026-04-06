# Jarvis AI - Product Requirements Document

## Overview
Jarvis is a standalone AI assistant mobile app (Expo/React Native) inspired by Iron Man's JARVIS. It uses Together.ai (Llama 3.3 70B) for unrestricted AI chat, has direct Binance trading integration, file upload/analysis, and can interact with the user's iPhone (contacts, calendar, location, clipboard).

## Architecture
- **Frontend**: Expo React Native (iOS + Android + Web)
- **Backend**: FastAPI (Python) — Deployed on Railway (auto-deploys from GitHub)
- **Database**: MongoDB
- **AI**: Together.ai Llama 3.3 70B (user's own key, no Emergent dependency)
- **Trading**: Binance API (python-binance)

## Core Features

### Implemented
1. **Unrestricted AI Chat** — JARVIS persona (nonchalant, British wit, no safety disclaimers), powered by Llama 3.3 70B via Together.ai
2. **File Upload & Analysis** — Upload documents (PDF, txt, CSV, JSON, code files) via `+` button, JARVIS reads and analyzes them
3. **iOS Native Integrations** — JARVIS can access:
   - Contacts (search, list)
   - Calendar (upcoming events)
   - Location (GPS + reverse geocode)
   - Clipboard (copy text)
   - Sharing (share content)
4. **Binance Trading Backend** — Portfolio view, price checks, market/limit orders, trade history
5. **AI-Powered Trading** — JARVIS understands natural language trading commands and generates action blocks
6. **Conversation Storage** — All chats saved to MongoDB
7. **Health Monitoring** — Health endpoint with LLM + Binance status
8. **Better Error Handling** — Descriptive error messages (rate limit, auth, timeout) instead of generic failures

### Upcoming
1. Book Writing assistant mode
2. Business Planning assistant mode
3. Re-introduce UI polish (icons, animations) carefully

### Future
1. Automated trading strategies
2. Secure on-device API key storage (SecureStore)
3. Siri Shortcuts integration

## API Endpoints
- `GET /api/health` — System health check
- `POST /api/chat` — Chat with JARVIS (Llama 3.3 + trading + device actions)
- `POST /api/chat/stream` — Streaming chat response
- `POST /api/upload` — Upload and extract text from files
- `POST /api/chat/with-file` — Chat with file context
- `GET /api/binance/portfolio` — Portfolio balances
- `GET /api/binance/prices` — Major crypto prices
- `GET /api/binance/price/{symbol}` — Specific pair price
- `POST /api/binance/trade` — Place a trade
- `GET /api/binance/trades` — Recent trade history

## Known Limitations
- Binance API blocked from Railway server (US geo-restriction) — needs user clarification on Binance.US vs Global
- iOS native features (contacts, calendar, location) require a new EAS build to test on device
- UI is intentionally minimal (stripped to fix iOS build crash) — needs gradual re-polish
