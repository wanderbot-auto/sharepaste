# SharePaste Android

Native Android client for SharePaste.

Current role: native Android shell plus a transitional Kotlin runtime while shared client logic converges onto `crates/client-runtime`.

## Status

This module now contains a full Android Studio project scaffold with:

- Jetpack Compose dashboard UI
- gRPC transport wired to `packages/proto/sharepaste.proto`
- foreground sync service
- local session persistence
- share target entrypoint for text/image/file payloads

## Planned runtime behavior

- Foreground: app can observe clipboard text changes and auto-send.
- Background: app keeps the realtime connection alive via a foreground service.
- System-wide clipboard auto-read is intentionally not attempted in background because Android restricts it on modern versions.

## Open locally

Open `apps/mobile-android` in Android Studio.

Tracking:

- convergence plan: `docs/architecture/client-runtime-convergence-plan-2026-03-16.md`
- parity matrix: `docs/architecture/client-runtime-parity-matrix-2026-03-17.md`
