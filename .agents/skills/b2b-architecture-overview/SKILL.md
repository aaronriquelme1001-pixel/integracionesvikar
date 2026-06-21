---
name: b2b-architecture-overview
description: Global architecture of the integraciones-vikar B2B Engine. Use this to understand how GPS Server, Dispatcher, Datalake, and 3rd party APIs interact.
---

# B2B Architecture Overview

## The Global Pipeline
1. **Pollers**: Connect to the source of truth (e.g., GPS Server via `OBJECT_GET_LOCATIONS`) to fetch real-time data for all vehicles.
2. **Dispatcher (`src/core/dispatcher.js`)**: The "Chessboard". It receives a raw coordinate, checks Anti-Spam rules, resolves dynamic/static configuration, and routes the data to the appropriate endpoints (e.g., Traccar, AVL, Datalake).
3. **Integrations**: Each destination has a dedicated strategy file in `src/integrations/`. They format the data specifically for that endpoint and handle delivery (e.g., batching for AVL, instant for Traccar).
4. **Datalake (`global_telemetry_traffic`)**: A PostgreSQL database that silently archives every single point processed by the engine for historical billing and state recovery.

## Design Philosophy
- **Zero-Code Routing**: No hardcoding of clients. Vehicles map automatically based on their assigned user in the GPS Server.
- **Fail-Safe Segregation**: If one integration (like AVL) crashes or gets rate-limited, it MUST NOT block Traccar or the Datalake.
- **Stateless Resilience**: The engine must be able to restart without losing historical data (achieved via DB hydration).
