# SharePaste v1

SharePaste is a cross-platform clipboard sharing system with an anonymous device-group model, 6-digit binding flow, and E2EE payload transport.

This repository ships:

- `apps/server/`: gRPC relay/control service (headless)
- `apps/client-cli/`: cross-platform client core + CLI runtime (Windows/macOS/Linux)
- `apps/desktop-macos/`: native macOS status-bar app (SwiftUI)
- `apps/desktop-windows/`: native Windows desktop app (Tauri + Rust backend + runtime bridge)
- `apps/desktop-linux/`: planned Linux desktop shell placeholder
- `apps/mobile-android/`: native Android client app (standalone Android Studio/Gradle project)
- `packages/proto/`: shared gRPC contract
- `packages/client-core/`: current TypeScript reference implementation of shared client logic
- `crates/client-runtime/`: long-term Rust shared runtime for cross-platform consistency

## Current client status

- Implemented client surfaces today: CLI (`apps/client-cli`), macOS desktop (`apps/desktop-macos`), Windows desktop (`apps/desktop-windows`), and Android (`apps/mobile-android`)
- Linux desktop remains a future shell placeholder
- Root scripts currently cover the Node-based server/CLI flow plus native macOS and Windows shells; Android is maintained as a standalone Gradle project

## Implemented v1 capabilities

- 6-digit bind code (`60s` TTL) with attempt limit (5) and target-device confirmation
- Anonymous single-user device group with recovery phrase
- Device management (`register`, `list`, `rename`, `remove`, `recover`)
- Unified group sharing policy with optimistic version checks
- Clipboard sync protocol with loopback suppression and item dedup (`item_id`)
- Offline queue (24h TTL) and ACK-based cleanup
- E2EE-style opaque payload transport (`ciphertext + nonce`)
- Group key rotation when a new device joins a group
- Local history cap of 50 entries in client core
- LAN discovery adapter (mDNS) + cloud stream fallback design hooks

## Project layout

- `/apps/server/src`: gRPC server + in-memory domain store
- `/apps/client-cli/src`: client core modules
  - `adapters/clipboard-watcher.ts`
  - `adapters/lan-discovery.ts`
  - `core/sync-engine.ts`
  - `core/crypto-agent.ts`
  - `core/sharepaste-client.ts`
- `/apps/desktop-macos/Sources`: native macOS shell
- `/apps/desktop-windows/src-tauri`: native Windows shell backend (tray, window, clipboard bridge)
- `/apps/desktop-windows/web`: Windows desktop UI
- `/apps/mobile-android/app/src`: native Android app (Compose UI, transport, sync service, share target)
- `/packages/client-core/src`: current extracted TypeScript client runtime modules
- `/packages/proto/sharepaste.proto`: shared protocol schema
- `/crates/client-runtime/src`: Rust shared runtime modules
- `/docs/architecture/repo-structure.md`: repo layout and ownership guide

## Development preparation docs

- `docs/pre-dev/PRD-v0.1-internal-pilot.md`
- `docs/pre-dev/TECH-DESIGN-v0.1.md`
- `docs/pre-dev/SECOPS-BASELINE-v0.1.md`
- `docs/pre-dev/TEST-RELEASE-PLAN-v0.1.md`
- `docs/pre-dev/EXECUTION-WBS-v0.1.md`

## Operations docs

- `docs/ops/monitoring-baseline.md`
- `docs/ops/incident-runbook.md`
- `docs/ops/release-checklist.md`
- `docs/ops/vps-deployment.md`
- `docs/ops/server-allinone-container.md`

## Quick start

```bash
npm install
npm run server:dev
# in another terminal
npm run client:dev -- init --name my-laptop
npm run client:dev -- run
```

Durable backend mode (Postgres + Redis):

```bash
docker compose up -d postgres redis
SHAREPASTE_STORAGE_MODE=durable npm run server:dev
```

Useful CLI commands:

```bash
npm run client:dev -- devices
npm run client:dev -- remove-device --target-device-id dev_xxx
npm run client:dev -- bind-code
npm run client:dev -- bind-request --code 123456
npm run client:dev -- bind-confirm --request-id req_xxx --approve
npm run client:dev -- recover --phrase <recovery_phrase> --name my-new-device
npm run client:dev -- policy --allow-text true --allow-image true --allow-file true --max-file-size 3145728
npm run client:dev -- send-text --value "hello from sharepaste"
npm run client:dev -- send-file --path ./small.zip
npm run client:dev -- send-image --path ./image.png
```

## Tests

```bash
npm test
cargo test -p sharepaste-client-runtime
```

Run storage integration tests (requires local Postgres + Redis):

```bash
docker compose up -d postgres redis
SHAREPASTE_INTEGRATION=1 SHAREPASTE_STORAGE_MODE=durable npm run server:test
```

Current tests cover binding, policy conflicts, offline TTL handling, dedup/loop suppression, ring-buffer history, and cryptographic envelope round trips.

Android unit tests live under `apps/mobile-android/app/src/test`. You can run them from the repo root with `npm run android:test`, but they are not currently wired into the aggregate `npm test` command.

## Release

Pushing a tag like `v0.1.0` triggers `.github/workflows/release-client.yml`, which builds the native macOS desktop binary and uploads artifacts to GitHub Release.

## Native macOS status-bar app

Prerequisites:

- macOS 13+
- Xcode 15+ (or Swift toolchain with SwiftUI support)
- Node.js 20+ (for underlying `client` CLI bridge)

Launch desktop shell in development mode:

```bash
npm run desktop:macos:dev
```

Build release binary:

```bash
npm run desktop:macos:build
```

## Native Windows desktop app

Current module status:

- Tauri shell with static desktop UI
- Rust backend for tray behavior, native clipboard access, and runtime bridge management
- Node runtime bridge that reuses `@sharepaste/client` business logic without routing through the CLI parser
- Text and image clipboard polling for Windows shell integration
- Close-to-tray lifecycle with background sync semantics

Run locally:

```bash
npm run desktop:windows:dev
```

Build with Cargo:

```bash
npm run desktop:windows:build
```

## Native Android app

Current module status:

- Jetpack Compose dashboard UI
- gRPC transport wired to `packages/proto/sharepaste.proto`
- Foreground sync service for keeping the realtime connection alive
- Local session persistence and incoming item storage
- Android share target for text, image, and file payloads
- Foreground clipboard text observation; background clipboard auto-read is intentionally not attempted on modern Android

Open locally in Android Studio using `apps/mobile-android`.

From the repo root you can also use:

```bash
npm run android:test
npm run android:build
```
