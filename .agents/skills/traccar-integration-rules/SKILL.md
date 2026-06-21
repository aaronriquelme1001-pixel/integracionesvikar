---
name: traccar-integration-rules
description: Documentation for routing data to Traccar using the OsmAnd protocol.
---

# Traccar Integration Rules

## The Protocol
We integrate with Traccar using the **OsmAnd Protocol** over HTTP GET requests (usually Port 5055).

## Critical Parameters
- `id`: Must be the IMEI of the device.
- `lat` & `lon`: Coordinates.
- `timestamp`: **CRITICAL**. Must be a Unix Epoch timestamp in SECONDS, not milliseconds. Traccar uses this to properly sort historical curves (Backfill).
- `valid`: String `"true"` or `"false"`.

## Error Handling
If Traccar responds with a 400 or 404, it usually means the device IMEI is not registered in that specific Traccar server instance. The B2B engine must catch this error gracefully and not crash the poller loop.
