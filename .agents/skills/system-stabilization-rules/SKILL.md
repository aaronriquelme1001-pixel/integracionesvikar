---
name: system-stabilization-rules
description: Essential guidelines for coding within the B2B engine. Covers timezone handling (Chile UTC-4), webhook error boundaries, database lookups (case/dash insensitivity), and event loop stability. Read this before modifying cron jobs, webhooks, or API routes.
---

# System Stabilization Rules (Lessons Learned)

To prevent breaking the reality of the B2B engine, always adhere to these rules when coding or modifying the system.

## 1. Timezone Handling in Cron Jobs
Render servers run in UTC. Chile operates in UTC-4 (or UTC-3 during daylight saving, though currently fixed to UTC-4/3 depending on the season).
- **Rule**: When calculating the "current day" for a daily snapshot or a database cutoff, **NEVER** use `new Date().toISOString().split('T')[0]` directly, as this will jump to "tomorrow" at 20:00 PM local time.
- **Solution**: Always offset the server time to the local timezone before extracting the date string.
  ```javascript
  const d = new Date();
  d.setHours(d.getHours() - 4); // Adjust for Chile time
  const snapshotDate = d.toISOString().split('T')[0];
  ```

## 2. Webhook Error Boundaries
Webhooks (e.g., in `src/webhooks/gpsServer.js`) are triggered by external services.
- **Rule**: Never leave the main dispatch logic un-wrapped. If `dispatchToB2B` throws an error and it isn't caught, the Express request will hang or crash.
- **Solution**: Always wrap webhook dispatch logic in a `try/catch` and return HTTP 500 on failure, ensuring the server stays responsive.

## 3. Database Lookups (Robust Formatting)
Clients and external systems input license plates with varying formats (e.g., `LWPS57`, `lw-ps-57`, `lw ps 57`).
- **Rule**: Never use exact matching (`WHERE plate = $1`) for human-entered or third-party identifiers in SQL queries.
- **Solution**: Use case-insensitive and character-stripped matching for plates:
  `WHERE REPLACE(LOWER(plate), '-', '') = REPLACE(LOWER($1), '-', '')`

## 4. Main Event Loop Resiliency
When triggering recurring asynchronous tasks via `setInterval` in the main `index.js`.
- **Rule**: An unhandled rejection inside a `setInterval` can permanently stop the recurring task execution if not caught.
- **Solution**: Always attach a `.catch()` to promises executed within `setInterval`.
  ```javascript
  setInterval(() => {
    myAsyncFunction().catch(err => console.error(err));
  }, 60000);
  ```

Failure to follow these rules will result in silent data corruption, "time-travel" bugs, or hanging APIs.
