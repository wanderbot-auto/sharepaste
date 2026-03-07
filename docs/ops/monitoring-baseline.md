# SharePaste Monitoring Baseline

## Metrics
- gRPC request count, error ratio, and p95 latency by method.
- Active streaming sessions.
- Bind code request/approval/rejection counts.
- Offline queue depth and expiry drop counts.

## Alerts
- Error ratio > 5% over 5 minutes.
- p95 unary latency > 300ms over 10 minutes.
- Bind approval success ratio < 90% over 10 minutes.
- Offline queue expiry drops > 10% over 30 minutes.

## Log fields
- timestamp
- level
- rpc_method
- request_id
- device_id
- group_id
- status_code
- latency_ms
