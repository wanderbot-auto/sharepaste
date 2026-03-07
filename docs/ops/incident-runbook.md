# SharePaste Incident Runbook

## Service Down
1. Verify health by calling gRPC reflection/health endpoint or process liveness.
2. Check recent deploy and server logs for startup/config failures.
3. Roll back to last known good artifact.
4. Confirm register/list/sync smoke paths.

## Postgres Degraded
1. Verify DB connectivity and slow query metrics.
2. Pause high-frequency mutating calls if needed.
3. Restore DB service and replay pending operations if any.
4. Validate snapshot/audit write path.

## Redis Degraded
1. Validate redis connection and keyspace health.
2. Continue with degraded runtime signals (presence/rate-limit fallback).
3. Restore Redis and verify reconnect.
4. Confirm bind and stream session behavior.
