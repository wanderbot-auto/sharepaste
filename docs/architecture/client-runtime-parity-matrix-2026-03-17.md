# Client Runtime Parity Matrix

Date: 2026-03-17

Purpose: track which platform-neutral rules already have aligned implementations and tests across TypeScript, Kotlin, and Rust while SharePaste converges on `crates/client-runtime`.

## Scope

Included:

- `packages/client-core`
- `apps/mobile-android` Kotlin runtime
- `crates/client-runtime`

Excluded:

- platform adapters such as clipboard, persistence, LAN discovery, tray, share targets
- UI state and presentation flows
- end-to-end transport wiring

## Canonical Ownership

- Canonical target owner: `crates/client-runtime`
- Transitional implementations:
  - `packages/client-core`
  - Android Kotlin runtime under `apps/mobile-android/app/src/main/kotlin/dev/sharepaste/android/data`

## Matrix

| Area | Canonical Rust source | TypeScript status | Android Kotlin status | Current parity status |
| --- | --- | --- | --- | --- |
| Clipboard payload shape | `crates/client-runtime/src/types.rs` | mirrored in `packages/client-core/src/types.ts` | mirrored in `apps/mobile-android/.../model/Models.kt` | Structurally aligned, no automated cross-language parity harness yet |
| Policy defaults and file-size boundary | `crates/client-runtime/src/policy.rs` | covered by `packages/client-core/test/core.test.ts` | covered by `SyncEngineTest.kt` | Behavior aligned for current rules |
| History bound of 50 | `crates/client-runtime/src/history.rs` | covered by `packages/client-core/test/core.test.ts` | repository behavior exists, direct unit test missing | Partial |
| Item-id generation format | `crates/client-runtime/src/sync.rs` | covered by `packages/client-core/test/core.test.ts` | covered by `SyncEngineTest.kt` | Format aligned, random suffix prevents exact-value parity |
| Duplicate suppression | `crates/client-runtime/src/sync.rs` | covered by `packages/client-core/test/core.test.ts` | covered by `SyncEngineTest.kt` | Behavior aligned |
| Loopback suppression | `crates/client-runtime/src/sync.rs` | covered by `packages/client-core/test/core.test.ts` | covered by `SyncEngineTest.kt` | Behavior aligned |
| AES-GCM clipboard encryption | `crates/client-runtime/src/crypto.rs` | covered by `packages/client-core/test/crypto.test.ts` | covered by `SharePasteCryptoTest.kt` | Behavior aligned at round-trip level |
| PEM/raw key compatibility | `crates/client-runtime/src/crypto.rs` | exercised through `packages/client-core/src/core/crypto-agent.ts` and `packages/client-core/test/crypto.test.ts` | Kotlin still keeps PEM-native implementation | Transitional, Rust compatibility APIs now exist |
| Sealed group-key extraction | `crates/client-runtime/src/crypto.rs` | covered by `packages/client-core/test/crypto.test.ts` via seal/unseal flow | legacy inline envelope covered by `SharePasteCryptoTest.kt` | Partial; Android does not yet bind to Rust |

## Test References

Rust:

- `crates/client-runtime/tests/runtime.rs`
- `crates/client-runtime/tests/crypto.rs`

TypeScript:

- `packages/client-core/test/core.test.ts`
- `packages/client-core/test/crypto.test.ts`

Android:

- `apps/mobile-android/app/src/test/kotlin/dev/sharepaste/android/data/SyncEngineTest.kt`
- `apps/mobile-android/app/src/test/kotlin/dev/sharepaste/android/data/SharePasteCryptoTest.kt`

## Gaps To Close Next

1. Add a direct Android history-cap test or move history ownership behind Rust bindings.
2. Add a generated fixture/parity harness for `types/policy/sync` semantics so TS, Kotlin, and Rust consume the same cases.
3. Move PEM-native key handling behind Rust bindings so Android and TS stop owning crypto behavior separately.
4. Introduce Rust-owned session orchestration after shared-rule parity is frozen.
