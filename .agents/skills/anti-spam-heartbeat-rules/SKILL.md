---
name: anti-spam-heartbeat-rules
description: Documentation for the dispatcher's Anti-Spam and Anti-Drift filters.
---

# Anti-Spam & Heartbeat Rules

The `dispatcher.js` acts as the gatekeeper to prevent external APIs from being flooded with duplicate or invalid data.

## 1. Anti-Spam (10 Seconds)
If a tracker sends 5 identical points in the same second, only the first one is dispatched. Any subsequent point with the exact same `lat/lng` is ignored unless at least 10 seconds have passed.

## 2. Anti-Drift (160 km/h)
LBS (Cell Tower) bounces occur when a tracker loses GPS fix and connects to a distant cell tower, creating a massive artificial jump.
If the calculated speed between two points exceeds 160 km/h, the point is classified as an LBS bounce and is **SILENTLY BLOCKED**.

## 3. The 20-Minute Heartbeat
If a vehicle is parked (engine off, no movement), the Anti-Spam filter will block its repetitive identical coordinates.
To prevent third-party systems from marking the vehicle as "Offline", the dispatcher has a **Heartbeat override**: If the vehicle hasn't sent a point in 20 minutes, the duplicate coordinate is allowed through to keep the connection alive.
