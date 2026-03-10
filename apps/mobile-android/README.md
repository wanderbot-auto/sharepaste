# SharePaste Android

Native Android client for SharePaste.

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
