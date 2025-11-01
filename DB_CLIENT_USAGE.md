# Database Client - Quick Reference

## Overview

The new `dbClient.js` module provides fault-tolerant database operations for your monitoring worker. It handles duplicate key errors, retries transient failures, and provides comprehensive logging.

## API Reference

### `saveAuditRecord(record, table, options)`

Save or update a single audit record with automatic conflict resolution.

**Parameters:**
- `record` (object) - Audit data to save (must include `publisher_id` and `domain`)
- `table` (string, default: `'site_audits'`) - Target table name
- `options` (object) - Additional options
  - `retryCount` (number, internal use only)

**Returns:** `Promise<{success: boolean, data: object|null, error: string|null}>`

**Example:**
```javascript
import { saveAuditRecord } from './dbClient.js';

const auditData = {
  publisher_id: '550e8400-e29b-41d4-a716-446655440000',
  domain: 'example.com',
  seo_score: 85,
  security_score: 90,
  performance_score: 75,
  // ... other fields
};

const result = await saveAuditRecord(auditData);

if (result.success) {
  console.log('Saved:', result.data);
} else {
  console.error('Failed:', result.error);
}
```

### `batchSaveAuditRecords(records, table)`

Save multiple audit records with consolidated metrics.

**Parameters:**
- `records` (array) - Array of audit records
- `table` (string, default: `'site_audits'`) - Target table name

**Returns:** `Promise<{successful: number, failed: number, errors: array}>`

**Example:**
```javascript
import { batchSaveAuditRecords } from './dbClient.js';

const results = await batchSaveAuditRecords([auditData1, auditData2, auditData3]);

console.log(`Saved ${results.successful}, failed ${results.failed}`);
if (results.errors.length > 0) {
  results.errors.forEach(err => {
    console.error(`${err.domain}: ${err.error}`);
  });
}
```

### `checkDatabaseHealth()`

Verify Supabase connection and table availability.

**Returns:** `Promise<{connected: boolean, message: string}>`

**Example:**
```javascript
import { checkDatabaseHealth } from './dbClient.js';

const health = await checkDatabaseHealth();

if (health.connected) {
  console.log('Database OK:', health.message);
} else {
  console.error('Database ERROR:', health.message);
}
```

## How Conflicts Are Resolved

### Scenario 1: First Save (New Record)
```
Input: { publisher_id: 'abc', domain: 'example.com', seo_score: 85 }
     ↓
Action: UPSERT
     ↓
Result: ✅ Inserted into site_audits
```

### Scenario 2: Duplicate Key Error (Record Exists)
```
Input: { publisher_id: 'abc', domain: 'example.com', seo_score: 92 }
     ↓
Action: UPSERT fails (duplicate key)
     ↓
Fallback: UPDATE existing record
     ↓
Result: ✅ Updated seo_score from 85 to 92
```

### Scenario 3: Transient Network Error
```
Input: { publisher_id: 'abc', domain: 'example.com', ... }
     ↓
Action: UPSERT fails (timeout)
     ↓
Retry 1: Wait 1s, try again
     ↓
Retry 2: Wait 2s, try again
     ↓
Retry 3: Wait 4s, try again
     ↓
Result: ✅ Eventually succeeds OR returns error
```

## Logging Examples

### Successful Save
```
[DB-CLIENT] Attempting to save record for domain: example.com (attempt 1/3)
[DB-CLIENT] Successfully saved record for example.com
```

### Duplicate Update
```
[DB-CLIENT] Attempting to save record for domain: example.com (attempt 1/3)
[DB-CLIENT] Duplicate key detected for example.com, attempting update instead...
[DB-CLIENT] Successfully updated existing record for example.com
```

### Retry After Timeout
```
[DB-CLIENT] Attempting to save record for domain: example.com (attempt 1/3)
[DB-CLIENT] Transient error for example.com, retrying in 2000ms: request timeout
[DB-CLIENT] Attempting to save record for domain: example.com (attempt 2/3)
[DB-CLIENT] Successfully saved record for example.com
```

### Permanent Error
```
[DB-CLIENT] Attempting to save record for domain: example.com (attempt 1/3)
[DB-CLIENT] Upsert failed for example.com: connection refused
```

## Integration in server.js

The crawler's audit endpoints already use `saveAuditRecord()`:

**Before:**
```javascript
const { error: dbError } = await supabaseClient
  .from('site_audits')
  .upsert(auditPayload, { onConflict: 'publisher_id,domain' });

if (dbError) {
  console.error('Database error:', dbError.message);
}
```

**After:**
```javascript
const saveResult = await saveAuditRecord(auditPayload);
if (saveResult.success) {
  console.log('Successfully saved');
} else {
  console.error('Database error:', saveResult.error);
}
```

## Error Handling Patterns

### Pattern 1: Fire and Forget
```javascript
await saveAuditRecord(data);
// Result ignored - save happens silently
```

### Pattern 2: Check Success
```javascript
const result = await saveAuditRecord(data);
if (!result.success) {
  console.error('Save failed:', result.error);
}
```

### Pattern 3: With Retry Logic
```javascript
let attempts = 0;
while (attempts < 3) {
  const result = await saveAuditRecord(data);
  if (result.success) break;
  attempts++;
  await new Promise(r => setTimeout(r, 1000 * attempts));
}
```

## Performance Tips

1. **Batch saves when possible** - Use `batchSaveAuditRecords()` for 10+ records
2. **Don't retry manually** - Built-in retry logic handles it
3. **Monitor health periodically** - Call `checkDatabaseHealth()` on startup
4. **Include all required fields** - Prevents validation errors

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `Missing required fields` | Missing `publisher_id` or `domain` | Verify audit payload has both fields |
| `Update operation failed` | Record doesn't exist in DB | Check if publisher exists first |
| `Health check failed` | Database unreachable | Verify SUPABASE_URL and credentials in .env |
| Repeated retries | Network is unstable | Check internet connection to Supabase |

## Environment Setup

Ensure your `.env` file has:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

The module will fail on startup if these are missing.

---

**Last Updated:** November 1, 2025
