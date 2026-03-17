# Client Runtime Convergence Checklist

Date: 2026-03-17

Reference: `docs/architecture/client-runtime-convergence-plan-2026-03-16.md`

## Phase 0: Baseline and Contracts

- [x] Document the convergence decision and target boundary
- [x] Record the current multi-client state in repo docs
- [x] Expose PEM-compatible Rust crypto entry points for current and future bindings
- [x] Add Rust tests covering PEM-based group-key seal/unseal
- [x] Add an explicit parity matrix for TS, Kotlin, and Rust shared rules

## Phase 1: Canonicalize Core Data and Rules

- [ ] Freeze canonical `types` semantics under parity tests
- [ ] Freeze canonical `policy` semantics under parity tests
- [ ] Freeze canonical `history` semantics under parity tests
- [ ] Freeze canonical `sync` semantics under parity tests
- [x] Mark `packages/client-core` and Android duplicates as transitional in code/docs

Notes:

- parity matrix: `docs/architecture/client-runtime-parity-matrix-2026-03-17.md`
- direct parity coverage is now strongest for `policy`, `sync`, and crypto round trips; `types` and `history` still need a shared fixture or binding-based harness

## Phase 2: Session and Group-Key Orchestration

- [ ] Add a Rust-owned client session state model
- [ ] Move pure register/recover/bind/key-refresh orchestration into Rust
- [ ] Define adapter contracts for transport, persistence, clipboard, and incoming-item materialization
- [ ] Switch `apps/client-cli` to Rust-owned orchestration while keeping existing adapters

## Phase 3: Platform Binding Adoption

- [ ] Replace Windows Node business bridge with direct Rust core usage
- [ ] Replace macOS CLI subprocess orchestration with direct Rust core usage
- [ ] Introduce Android binding integration for shared sync/crypto/session logic
- [ ] Add an iOS/macOS native binding plan once mobile/desktop adapter seams are stable

## Phase 4: Transitional Layer Removal

- [ ] Reduce `packages/client-core` to a compatibility facade or retire it from the main path
- [ ] Remove duplicated Kotlin sync/crypto logic after native binding rollout
- [ ] Keep only platform adapters and UI outside the shared Rust core
