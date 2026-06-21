---
name: render-deployment-workflow
description: Workflow for deploying code to Render and checking logs without panicking.
---

# Render Deployment Workflow

## Deployment Process
1. Commit and push code to GitHub (`main` branch).
2. Render is configured to build automatically, but if a quick patch is needed, instruct the user to press **Manual Deploy** in the Render Dashboard.
3. Wait ~2-3 minutes for the container to build and boot up.

## Reading Render Logs
- **The "Red Error" Trap**: Render's log viewer is primitive. It highlights any line containing the word "error" (case-insensitive) in red text.
- **Example**: `Batch Success Response: {"error_count": 0}` will be painted RED, even though it's a 100% successful response. 
- **Rule**: ALWAYS read the JSON payload before assuming a red log line is an actual failure. Look for `result: true` and HTTP Status 200.
