# Jarvis v2 — Product Requirements Document

## Vision
A personal AI assistant app for iOS that can autonomously manage digital tasks, modify its own codebase, and push self-updates via GitHub + TestFlight (and OTA via expo-updates).

## Core Architecture
- **Frontend**: Expo React Native (file-based routing via expo-router)
- **Backend**: FastAPI on Python
- **Database**: MongoDB (conversation persistence)
- **LLM**: Anthropic Claude (claude-sonnet-4-6)
- **Self-update**: GitHub Actions + EAS Build + TestFlight / expo-updates OTA

## Key Design Decision
The backend handles server-side tool loops internally (code, deploy, git tools) and only returns to the frontend when:
1. Claude has a final text response
2. Claude needs a device-side tool (contacts, calendar, location, TTS)

This eliminates frontend parsing complexity and reduces round-trips.

## Phase 1 (MVP) — COMPLETED
- [x] Clean FastAPI backend with Claude integration
- [x] Conversational chat UI (dark theme, mobile-first)
- [x] Persistent memory via MongoDB
- [x] Tool execution framework (server + device tools)
- [x] Server tools: listRepoPaths, readCodeFile, writeCodeFile, patchCodeFile, commitAndPush, triggerIOSBuild
- [x] Device tools: getLocation, getContacts, getCalendar, speakText
- [x] Stop and Clear Memory buttons
- [x] Backend-tested all endpoints

## Phase 2 — Self-Updating
- [ ] GitHub integration (push code from within app)
- [ ] EAS Build + TestFlight pipeline
- [ ] expo-updates for OTA JS changes
- [ ] Jarvis modifies its own code and triggers rebuilds

## Phase 3 — Device & Ecosystem
- [ ] iOS native integrations (Contacts, Calendar, Reminders, Location)
- [ ] TTS with ElevenLabs (custom Jarvis voice)
- [ ] Chat modes (Book Writing, Business Planning)

## Phase 4 — Polish & Security
- [ ] SecureStore for API keys
- [ ] UI polish
- [ ] Standing orders / trust boundaries

## Credentials
All saved in `/app/memory/test_credentials.md`
