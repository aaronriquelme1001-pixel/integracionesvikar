---
name: avlchile-integration-rules
description: Rules for communicating with the AVL Chile API, including batching and rate limits.
---

# AVL Chile Integration Rules

## Batching and Rate Limits
AVL Chile's API has strict rate limits and is prone to crashing if flooded with concurrent requests.
**NEVER** send telemetry instantly via `Promise.all()`.
Instead, use the `batchQueues` system:
1. Push coordinates to a memory queue grouped by Token.
2. A background recursive loop (`while(true)`) flushes the queue every 10 seconds.
3. This ensures a mathematical 10-second spacing between requests, completely eliminating 429 Too Many Requests errors.

## The "False Error"
The AVL success response looks like this:
`{"status":{"result":true,"total_count":4,"valid_count":4,"error_count":0,"error":[]}}`
Because it literally contains the string `"error"`, naive log parsers (like Render) will paint it red. Do not panic; verify `error_count` is 0.
