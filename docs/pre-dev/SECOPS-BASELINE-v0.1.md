# SharePaste Security and Operations Baseline v0.1

- Version: 0.1
- Date baseline: 2026-03-07
- Security tier: Engineering baseline (non-compliance tier)

## 1. Security Baseline
### Key handling
- Device keypairs are generated and stored locally on each device.
- Group key material is sealed per device public key before transport.
- Server handles opaque ciphertext envelopes; it must not log plaintext content.

### Access and revocation
- Device removal invalidates further group operations for the removed device.
- Event stream sessions require active device identity.
- Bind and policy operations are checked against group membership and role context.

### Audit minimum set
Audit record is required for:
- RegisterDevice
- RecoverGroup
- CreateBindCode
- RequestBind
- ConfirmBind
- UpdatePolicy
- RemoveDevice
- PushClipboardItem (metadata only)

Each audit record must include:
- request_id
- actor_device_id
- group_id
- action
- result (success/failure)
- error_code (if failure)
- timestamp

## 2. Logging Baseline
### Structured logging fields
- level
- timestamp
- service
- rpc_method
- request_id
- device_id
- group_id
- latency_ms
- status_code

### Redaction rules
- Never log recovery phrase.
- Never log raw private keys.
- Never log clipboard plaintext/ciphertext bytes.
- Hash or truncate identifiers in high-volume warning logs when possible.

## 3. Monitoring and Alerting
### Required dashboards
- RPC latency and error ratio by method.
- Active event streams.
- Bind success/failure trends.
- Offline queue depth and expiration drops.
- Desktop crash-free session trend.

### Initial alert thresholds
- 5xx-equivalent RPC failure ratio > 5% for 5m.
- Bind success ratio < 90% for 10m.
- Offline queue drop (expired) > 10% in 30m.
- Event stream disconnect spike > 3x rolling baseline.

## 4. Incident Playbooks (minimum)
- Service unavailable: fail health checks, trigger rollback to last stable tag.
- Redis unavailable: disable presence-dependent optimizations, preserve core unary operations.
- Postgres degraded: switch to read-protect mode for mutating operations after threshold breach.

## 5. Compliance Boundary
This phase does not claim SOC2/ISO/HIPAA compliance. Deliverables are engineering controls only:
- auditable operation trail
- secret redaction discipline
- reproducible incident response checklist
