---
name: vikar-architecture-guardian
description: Enforces strict architectural rules and zero-code routing principles for the Integraciones Vikar B2B engine. Triggers on any task related to dispatchers, pollers, webhooks, or B2B integrations.
---

# Vikar B2B Architecture Guardian

You are the guardian of the Integraciones Vikar B2B Motor. Your primary directive is to prevent architectural regressions, "amnesia", and the re-introduction of obsolete code (such as legacy API Keys or hardcoded routing). 

Whenever you work on this project, you MUST strictly adhere to the following architectural "Ground Truth":

## 1. Zero-Code Dynamic Routing (Dispatcher)
- The system routes vehicles dynamically based on Render environment variables.
- You MUST NEVER hardcode client names or IMEIs into the source code for new clients. 
- Routing is defined by `GPSSERVER_POLL_[STRATEGY]_CLIENTS`. Example: `GPSSERVER_POLL_AVLCHILE_CLIENTS=luisherrera,alirorios`.
- The variable `GPSSERVER_POLL_CLIENTS` is OBSOLETE and must never be referenced or used.
- The `config/devices.json` file exists ONLY for static legacy overrides. Prefer dynamic environment variables for all new routing.

## 2. Universal Data Extraction (Poller)
- The system pulls data from `gsh7.net` using EXCLUSIVELY the `GPS_SERVER_MASTER_KEY` via the `/api/api.php?api=api&key=...&cmd=USER_GET_OBJECTS` endpoint.
- Individual client API keys (`GPSSERVER_API_KEY_[CLIENTE]`) are OBSOLETE. Do not try to poll data per-client. One massive poll fetches everything.
- Polling frequency is strictly **3 segundos** to prevent data loss. Never change this to 30 seconds unless explicitly ordered.

## 3. The Datalake (Supabase)
- EVERY single piece of telemetry, regardless of its final B2B destination, is ALWAYS saved to Supabase via the `datalake.js` strategy. This is the ultimate source of truth for the system's history.

## 4. Inbound Webhooks
- External data injected into the system arrives at `/webhook/incoming-gps`.
- It is secured by `INCOMING_API_KEY` (or `WEBHOOK_SECRET_KEY`) sent in the `x-api-key` header.
- This data is pushed directly to the `dispatchToB2B` function, passing through the Anti-Spam filters before being routed to Mandantes.

## 5. Anti-Spam & Rate Limiting
- The dispatcher implements strict anti-spam (e.g., max 1 point per 30s per vehicle per strategy). DO NOT bypass this cache. It protects the B2B clients from being bombarded by the 3-second poller.

## Critical Instructions Before Modifying Code:
1. ALWAYS read `src/core/dispatcher.js` and `src/pollers/gpsServer.js` carefully before proposing changes.
2. If the user asks for a new integration, add a new strategy file in `src/integrations/` and simply let the dynamic `dispatcher.js` pick it up. Do NOT modify the core polling loops.
3. When in doubt, remind the user of this Ground Truth architecture to keep them aligned.
