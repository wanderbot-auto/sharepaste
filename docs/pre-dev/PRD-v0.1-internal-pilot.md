# SharePaste PRD v0.1 (Internal Pilot)

- Version: 0.1
- Stage: Internal Pilot (non-production)
- Date baseline: 2026-03-07
- Target release window: 2026-03-07 to 2026-04-18

## 1. Product Goal
Ship a desktop-first clipboard sharing experience for internal pilot users, validating the end-to-end flow of register, bind, sync, revoke, and recover with stable daily usage.

## 2. Target Audience
- Primary: Individual users with 2-3 personal devices.
- Pilot size: 10-50 users.
- Platform commitment in this phase: macOS desktop (Swift native).

## 3. Scope
### In scope
- Anonymous group registration and recovery phrase generation.
- 6-digit bind flow with issuer confirmation.
- Group device management: list, rename, remove.
- Policy update and conflict handling.
- Clipboard sync for text/image/file payloads via encrypted envelope.
- Offline queue fetch and ACK cleanup.
- Desktop shell for the core user path.

### Out of scope
- Mobile clients.
- Enterprise SSO and org management.
- Production SLA and on-call guarantee.
- Compliance certifications (SOC2, ISO27001, HIPAA, etc.).

## 4. Success Criteria
### Product metrics (pilot success)
- Pilot activation: >= 10 active users within 7 days after pilot start.
- Device pairing success rate: >= 95% for valid bind attempts.
- Clipboard delivery success rate: >= 98% for online same-group device transfers.
- Offline fetch success rate: >= 95% for queued non-expired items.
- 7-day crash-free desktop sessions: >= 99.0%.

### Stability gates (release candidate)
- No open P0 defects.
- <= 3 open P1 defects with approved workaround.
- Core path E2E pass rate: 100% on release branch.

## 5. Core User Journeys (must pass)
1. New user setup
- Register first device.
- Receive recovery phrase.
- Confirm policy defaults.

2. Add second device
- Generate bind code on device A.
- Request bind on device B.
- Approve on device A.
- Verify both devices in same group.

3. Clipboard sync
- Send text from device A and receive on device B.
- Send image from device B and receive on device A.
- Send file below policy limit and receive on peer.

4. Device revoke
- Remove device B from device A.
- Verify device B can no longer list/sync in group.

5. Group recovery
- Reinstall/new device.
- Recover group using recovery phrase.
- Verify recovered device can sync.

## 6. Functional Requirements
- FR-01: Registration returns group identifier, device identifier, and recovery phrase.
- FR-02: Bind code expires in 60s with max 5 attempts.
- FR-03: Group size limit is 10 active devices.
- FR-04: Policy update uses optimistic version check.
- FR-05: Offline queue TTL is 24h and supports explicit ACK cleanup.
- FR-06: Duplicate item IDs must be suppressed per group.
- FR-07: Source device mismatch must be rejected.

## 7. Non-Functional Requirements
- NFR-01: P95 server unary RPC latency < 300ms in pilot load profile.
- NFR-02: Event stream reconnection succeeds within 5s after transient disconnect.
- NFR-03: Logs must include correlation identifiers for pairing and item flows.
- NFR-04: Secrets are never logged in plaintext.

## 8. Acceptance Matrix
| Requirement | Acceptance check |
| --- | --- |
| FR-02 | Expired or exhausted bind code returns expected error and does not pair devices |
| FR-04 | Stale expected version returns policy conflict error |
| FR-05 | Item older than 24h is not returned by offline fetch |
| FR-06 | Repeated same item_id does not fan out duplicate delivery |
| FR-07 | PushClipboardItem with mismatched source_device_id is rejected |

## 9. Release Readiness Definition
Pilot release can start only when all are true:
- M1 and M2 milestone deliverables completed.
- Release gates in section 4 passed.
- Security and operations baseline checklist signed off.
