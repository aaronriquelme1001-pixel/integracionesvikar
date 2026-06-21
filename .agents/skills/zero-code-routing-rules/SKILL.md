---
name: zero-code-routing-rules
description: Rules for dynamic vehicle-to-client mapping without hardcoding configurations.
---

# Zero-Code Routing Rules

## The Problem with Static Configs
Previously, every vehicle had to be manually added to `config/devices.json`. This was unscalable for 700+ vehicles.

## The Zero-Code Solution
1. Use `GET_USERS_OBJECTS` from the GPS Server to automatically map an IMEI to its assigned `username` or `email` (the client).
2. Use Environment Variables like `GPSSERVER_POLL_TRACCAR_CLIENTS="admin,clientA"` to globally route all vehicles belonging to those clients to specific integrations.
3. **The Dispatcher Logic**:
   - Check if the vehicle's client is in the ENV variable for Traccar. If yes, route to Traccar.
   - Check if the vehicle's client is in the ENV variable for AVL. If yes, route to AVL.
   - ALWAYS route to Datalake.

## devices.json as Fallback
`devices.json` is now only a fallback for legacy clients (like `avlchile`) or specific edge cases that haven't been migrated to the dynamic user-grouping in the GPS Server. Note: The `devices.json` structure holds the devices at the root level, so parsing logic must handle `data.devices || data || {}`.
