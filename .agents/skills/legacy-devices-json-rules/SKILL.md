---
name: legacy-devices-json-rules
description: Rules for parsing the legacy devices.json file to avoid silent mapping failures.
---

# Legacy devices.json Rules

## The Root Parsing Bug (Historical Warning)
We previously encountered a silent bug where `devices.json` was entirely ignored by the system.
The code was returning `data.devices || {}`, but the actual JSON file didn't have a top-level `"devices"` key; the vehicle objects were directly at the root of the file.

## Correct Parsing Logic
When reading `config/devices.json` in any new script (e.g., `billing_snapshot.js` or `dispatcher.js`), you MUST parse it gracefully:
```javascript
const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
return data.devices || data || {};
```

## Usage
Only rely on `devices.json` as a fallback. Primary routing should always be handled dynamically by the Zero-Code `GET_USERS_OBJECTS` mapping.
