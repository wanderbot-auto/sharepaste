# SharePaste Technical Design v0.1

- Version: 0.1
- Date baseline: 2026-03-07
- Scope: Internal pilot architecture and implementation constraints

## 1. Architecture Target for This Phase
### Mandatory target shape
- Postgres: persistent source of truth for core metadata.
- Redis: session/presence indexes, rate-limit counters, short-lived bind state.
- Object storage: deferred; disabled for v0.1 pilot.

### Current state gap
Current server implementation is in-memory store. v0.1 implementation must move stateful domain data to durable storage for pilot continuity.

## 2. System Components
- Desktop app (Tauri + React): user entry point for core journey.
- Client core (TS): policy check, sync engine, crypto envelope handling.
- gRPC server: DeviceService, PairingService, PolicyService, SyncService.
- Postgres: durable device/group/policy/audit/offline metadata.
- Redis: transient stream presence and anti-abuse counters.

## 3. Data Model Baseline
### Postgres tables
- groups(id, recovery_phrase_hash, group_key_version, group_key_cipher, created_at, updated_at)
- devices(id, group_id, pubkey, name, platform, active, last_seen_at, created_at, updated_at)
- policies(group_id, allow_text, allow_image, allow_file, max_file_size_bytes, version, updated_by, updated_at)
- bind_requests(id, code, issuer_device_id, requester_device_id, expires_at, attempts_left, approved, created_at)
- offline_items(id, target_device_id, item_id, item_type, size_bytes, mime, cipher_ref, ciphertext, nonce, created_at_unix, expires_at_unix)
- audit_logs(id, event_type, actor_device_id, group_id, request_id, item_id, result, error_code, created_at)

### Redis keys
- presence:{device_id} -> lan_addr + heartbeat TTL
- bind_code:{code} -> issuer_device_id + attempts + expires_at
- ratelimit:{device_id}:{action} -> rolling counter

## 4. API and Contract Rules
- Canonical API contract: `proto/sharepaste.proto`.
- Compatibility rule: additive changes only.
- No renaming or semantic repurposing of existing fields in v1.
- Error semantics must remain stable across retries and reconnects.

### Error code baseline
| Domain error | gRPC code |
| --- | --- |
| DEVICE_NOT_FOUND | 5 |
| GROUP_NOT_FOUND | 5 |
| RECOVERY_PHRASE_INVALID | 16 |
| GROUP_MISMATCH | 9 |
| GROUP_DEVICE_LIMIT_REACHED | 8 |
| BIND_CODE_EXPIRED | 9 |
| BIND_CODE_EXHAUSTED | 8 |
| BIND_REQUEST_EXPIRED | 9 |
| ALREADY_BOUND | 6 |
| NOT_AUTHORIZED | 7 |
| POLICY_VERSION_CONFLICT | 10 |
| INVALID_MAX_FILE_SIZE | 3 |
| POLICY_REJECTED | 9 |
| SOURCE_DEVICE_MISMATCH | 3 |

## 5. Sequence Baseline
1. Pairing
- Issuer creates bind code (TTL 60s).
- Requester submits code.
- Issuer confirms or rejects.
- On approval, requester moves to issuer group and group key version increments.

2. Clipboard online sync
- Source pushes encrypted item.
- Server checks policy and duplicate suppression.
- Online peers receive event-stream message.

3. Offline delivery
- If peer is offline, enqueue item with 24h TTL.
- Peer fetches backlog on reconnect.
- Peer ACK removes delivered item.

4. Device revocation and recovery
- Active device removes target device.
- Removed device loses group operations.
- Recovery phrase allows rejoin as new device identity.

## 6. Migration Plan (in-memory to durable)
1. Introduce repository interfaces for groups/devices/policies/pairing/offline/audit.
2. Implement Postgres repositories and Redis adapters.
3. Run integration tests with docker compose dependencies.
4. Keep in-memory implementation for local fast test only.

## 7. Constraints
- Group max active devices: 10.
- Default max file size: 3 MiB.
- Offline retention: 24h.
- Dedup ring/window: bounded memory or Redis set with bounded cardinality.
