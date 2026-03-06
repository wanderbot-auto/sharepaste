# SharePaste v1

SharePaste is a cross-platform clipboard sharing system with an anonymous device-group model, 6-digit binding flow, and E2EE payload transport.

This repository ships two runnable packages:

- `server/`: gRPC relay/control service (headless)
- `client/`: cross-platform client core + CLI runtime (Windows/macOS/Linux)
- `desktop/`: Tauri desktop shell (React UI + Rust command bridge)

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

- `/proto/sharepaste.proto`: shared gRPC contract
- `/server/src`: gRPC server + in-memory domain store
- `/client/src`: client core modules
  - `adapters/clipboard-watcher.ts`
  - `adapters/lan-discovery.ts`
  - `core/sync-engine.ts`
  - `core/crypto-agent.ts`
  - `core/sharepaste-client.ts`

## Quick start

```bash
npm install
npm run -w server dev
# in another terminal
npm run -w client dev -- init --name my-laptop
npm run -w client dev -- run
```

Useful CLI commands:

```bash
npm run -w client dev -- devices
npm run -w client dev -- bind-code
npm run -w client dev -- bind-request --code 123456
npm run -w client dev -- bind-confirm --request-id req_xxx --approve
npm run -w client dev -- policy --allow-text true --allow-image true --allow-file true --max-file-size 3145728
npm run -w client dev -- send-text --value "hello from sharepaste"
npm run -w client dev -- send-file --path ./small.zip
npm run -w client dev -- send-image --path ./image.png
```

## Tests

```bash
npm test
```

Current tests cover binding, policy conflicts, offline TTL handling, dedup/loop suppression, ring-buffer history, and cryptographic envelope round trips.

## Tauri desktop shell

Prerequisites for desktop packaging/runtime:

- Node.js 20+
- Rust toolchain (`rustup`)
- Tauri system dependencies ([Tauri setup guide](https://v2.tauri.app/start/prerequisites/))

Launch desktop shell in development mode:

```bash
npm run -w desktop dev
```

If you only want to build/check the desktop web UI without Rust packaging:

```bash
npm run -w desktop build
```
