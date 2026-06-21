---
name: backfiller-ai-rules
description: Rules for the Backfiller AI that recovers missing historical data. Use this to understand why straight lines happen and how they are healed.
---

# Backfiller AI Rules

## The 15-Second Freeze Bug (Historical Warning)
**Never set the gap threshold too low (e.g., 15 seconds) and NEVER block the real-time point while waiting for history.** 
In the past, slow-reporting vehicles (every 60s) triggered the backfiller constantly, causing the engine to freeze their real-time position for 5 minutes waiting for historical points, which resulted in massive "jumps" (straight lines) in Traccar.

## Current Optimal Logic
1. **Detect Gap**: Compare `device.dt_tracker` with `lastDeviceTimestamps[imei]`.
2. **Thresholds**: 3 minutes if moving (`speed > 0`), 20 minutes if parked.
3. **Non-Blocking Queue**: If a gap is detected, DO NOT STOP the current point. Dispatch the current point immediately so Live Tracking has zero delay. Add the gap to `pendingBackfills` to be executed 3 minutes in the future (giving the tracker time to upload over GPRS).
4. **State Hydration**: Always hydrate `lastDeviceTimestamps` from the Datalake on startup, otherwise the engine will miss gaps that occurred while it was offline.
