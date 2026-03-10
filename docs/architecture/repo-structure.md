# Repository Structure

## Goals

- Separate deployable applications from shared assets.
- Keep the current macOS + CLI + server flow working while creating room for Windows, Linux, and Android clients.
- Make future extraction of reusable client logic incremental instead of forcing a large rewrite.
- Establish a Rust runtime that can become the stable cross-platform core for desktop and mobile clients.

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
  client-core/        Shared TypeScript reference runtime during migration
  proto/              Canonical protobuf schema
crates/
  client-runtime/     Long-term Rust shared runtime
docs/
  architecture/       Repo and system structure docs
  ops/                Operational runbooks and release docs
  pre-dev/            Product and design inputs
scripts/              Local developer entrypoints
```

## Ownership Rules

- `apps/*` contains runnable products with their own build and packaging concerns.
- `packages/*` contains code or contracts meant to be imported by multiple Node/TypeScript apps.
- `crates/*` contains Rust shared runtime components intended for long-term cross-platform reuse.
- `packages/proto` is the source of truth for the network contract.
- `apps/client-cli` is the current integration point for cross-platform client behavior.
- `packages/client-core` is the current TypeScript reference implementation during migration.
- `crates/client-runtime` is the target runtime for logic that must stay consistent across macOS, Windows, Linux, and Android.

## Near-Term Refactor Path

1. Keep the working CLI on `packages/client-core` while Rust coverage is still incomplete.
2. Port stable platform-agnostic domain logic into `crates/client-runtime`.
3. Introduce Rust bindings or adapters for desktop and mobile shells once transport and crypto layers land.
4. Keep per-platform shell code in `apps/desktop-*` and `apps/mobile-*`.
5. Keep protocol evolution centralized in `packages/proto`.

## Platform Guidance

- macOS: native SwiftUI shell calling the CLI bridge today, then migrate to shared core bindings later.
- Windows: start with a shell that reuses the same client behavior contract as macOS.
- Linux: keep packaging and desktop integration isolated from Windows and macOS concerns.
- Android: keep mobile UX, permissions, and background execution separate from desktop assumptions.

## Workspace Guidance

- Root npm workspaces only include active Node applications today.
- Rust workspace management lives in the root `Cargo.toml`.
- Non-Node apps such as Swift and future Android projects live under `apps/` but are built with platform-native tooling.
- Root scripts should target package names like `@sharepaste/server` instead of hard-coded directories when possible.
