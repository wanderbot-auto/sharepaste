# Repository Structure

## Goals

- Separate deployable applications from shared assets.
- Keep the current macOS + CLI + server flow working while creating room for Windows, Linux, and Android clients.
- Make future extraction of reusable client logic incremental instead of forcing a large rewrite.

## Top-Level Layout

```text
apps/
  client-cli/         TypeScript client runtime and CLI for desktop/server-side testing
  desktop-macos/      Native SwiftUI shell for macOS
  desktop-windows/    Planned native or hybrid Windows shell
  desktop-linux/      Planned native or hybrid Linux shell
  mobile-android/     Planned Android client shell
  server/             gRPC relay/control service
packages/
  client-core/        Planned shared client domain/runtime package
  proto/              Canonical protobuf schema
docs/
  architecture/       Repo and system structure docs
  ops/                Operational runbooks and release docs
  pre-dev/            Product and design inputs
scripts/              Local developer entrypoints
```

## Ownership Rules

- `apps/*` contains runnable products with their own build and packaging concerns.
- `packages/*` contains code or contracts meant to be imported by multiple apps.
- `packages/proto` is the source of truth for the network contract.
- `apps/client-cli` is the current integration point for cross-platform client behavior.
- `packages/client-core` is reserved for extracting logic now living under `apps/client-cli/src/core` and `apps/client-cli/src/adapters`.

## Near-Term Refactor Path

1. Extract pure TypeScript domain logic from `apps/client-cli` into `packages/client-core`.
2. Keep per-platform shell code in `apps/desktop-*` and `apps/mobile-*`.
3. Add generated SDK output under a future `packages/sdk-*` only after at least two consumers need it.
4. Keep protocol evolution centralized in `packages/proto`.

## Platform Guidance

- macOS: native SwiftUI shell calling the CLI bridge today, then migrate to shared core bindings later.
- Windows: start with a shell that reuses the same client behavior contract as macOS.
- Linux: keep packaging and desktop integration isolated from Windows and macOS concerns.
- Android: keep mobile UX, permissions, and background execution separate from desktop assumptions.

## Workspace Guidance

- Root npm workspaces only include active Node applications today.
- Non-Node apps such as Swift and future Android projects live under `apps/` but are built with platform-native tooling.
- Root scripts should target package names like `@sharepaste/server` instead of hard-coded directories when possible.
