# Stability Remediation Checklist

Date: 2026-03-10

## Protocol and server

- [x] Replace pseudo-sealed group keys with real per-device sealed payloads
- [ ] Add device-context refresh API for state validation and key refresh
- [x] Deliver live group-key rotation updates to connected devices
- [x] Keep durable and in-memory store behavior aligned

## Client and desktop

- [x] Validate saved device state against server before reuse
- [x] Persist refreshed group keys after bind approval and reconnect
- [x] Remove random-key fallback on invalid sealed payloads
- [x] Catch realtime stream processing failures without unhandled rejections
- [x] Materialize incoming image/file payloads to local files
- [x] Fail fast on invalid local state files instead of silently re-registering devices
- [x] Remove unsupported desktop policy controls that route to nonexistent CLI flags

## Validation

- [x] Add tests for key sealing and rotation refresh
- [ ] Add tests for stale-state refresh behavior
- [ ] Add tests for incoming file/image materialization
- [ ] Run test, lint, and build successfully
