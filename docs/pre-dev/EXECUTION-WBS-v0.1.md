# SharePaste Execution WBS v0.1

- Version: 0.1
- Date baseline: 2026-03-07
- Timeline: 6 weeks (M1 at week 3, M2 at week 6)

## 1. Workstreams and Ownership
- Backend owner: storage migration, service behavior parity, audit pipeline.
- Client owner: sync and policy integration parity, error handling alignment.
- Desktop owner: core user journey UI/UX and failure-state handling.
- QA owner: test matrix, CI gates, release qualification.
- Ops owner: logging, monitoring, alerting, rollback drills.

## 2. Week-by-Week Plan
1. Week 1 (2026-03-07 to 2026-03-13)
- Freeze PRD, TDS, SecOps, and test plan docs.
- Define repository interfaces and migration sequence.
- Set CI job skeleton for integration and E2E stages.

2. Week 2 (2026-03-14 to 2026-03-20)
- Implement Postgres persistence for groups/devices/policies.
- Implement Redis presence and bind-state support.
- Keep behavior compatible with existing proto contract.

3. Week 3 (2026-03-21 to 2026-03-28) -> M1
- Complete integration suite for durable backend.
- Enable desktop happy-path walkthrough.
- Run M1 release gate and publish internal RC.

4. Week 4 (2026-03-29 to 2026-04-03)
- Harden streaming reconnection and offline queue edge cases.
- Expand audit events and redaction enforcement.
- Add operational dashboards and threshold alerts.

5. Week 5 (2026-04-04 to 2026-04-10)
- Complete desktop revoke and recovery flows.
- Stabilize E2E scenarios across Windows/macOS.
- Burn down P1 defects and document workarounds.

6. Week 6 (2026-04-11 to 2026-04-18) -> M2
- Full regression and pilot acceptance run.
- Validate release and rollback runbooks.
- Publish Beta RC package and pilot handoff.

## 3. Definition of Done by Workstream
- Backend DoD: persistent data correctness, parity tests green, no API contract breaks.
- Client DoD: policy and sync behavior consistent with server semantics.
- Desktop DoD: all core journeys complete with actionable error feedback.
- QA DoD: gates encoded in CI and release checklist signed.
- Ops DoD: dashboards active, alerts verified, incident drill evidence stored.

## 4. Risk Register
- R1: Contract drift between server and clients.
- Mitigation: proto freeze policy and compatibility review per change.

- R2: Cross-platform clipboard behavior differences.
- Mitigation: platform-specific E2E matrix and fallback handling.

- R3: Offline queue inconsistency during reconnect storms.
- Mitigation: deterministic ACK/idempotency tests and load replay drills.

- R4: Late security hardening creates schedule risk.
- Mitigation: week-4 security checkpoint is mandatory gate for M2.
