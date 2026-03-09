# SharePaste Test and Release Plan v0.1

- Version: 0.1
- Date baseline: 2026-03-07
- Release mode: Internal pilot, desktop-first

## 1. Quality Strategy
- Unit tests: domain logic, policy engine, crypto agent, sync dedup/loop suppression.
- Integration tests: gRPC handlers + Postgres/Redis adapters.
- E2E tests: macOS desktop user journeys for register, bind, sync, revoke, recover.

## 2. Test Coverage Requirements
### Unit (must pass)
- Bind expiry and attempt exhaustion.
- Policy version conflict and size validation.
- Offline TTL cleanup and ACK removal.
- Group capacity limit.
- Duplicate item suppression.

### Integration (must pass)
- gRPC unary and streaming happy paths against real Postgres and Redis.
- Error mapping consistency to gRPC status codes.
- Durable restart behavior for devices, policies, and pending requests.

### E2E macOS desktop (must pass)
- A->B text sync.
- B->A image sync.
- Allowed file sync under policy limit.
- Revoked device blocked from operations.
- Recovery phrase rejoin and sync verification.

## 3. Release Gates
Gate to M1 (2026-03-28):
- All unit tests green on main.
- Integration suite green on CI.
- No open P0.

Gate to M2 (2026-04-18):
- All M1 gates plus full E2E suite green.
- P1 count <= 3 with workaround notes.
- Pilot runbook and rollback procedure approved.

## 4. Milestones and Deliverables
1. M1 Internal RC (2026-03-28)
- Durable backend baseline complete.
- Core desktop path testable.
- Initial dashboards and alerts online.

2. M2 Beta RC (2026-04-18)
- Full core journey coverage complete.
- Security and operations baseline fully adopted.
- Pilot acceptance report generated.

## 5. Regression Cadence
- Daily: unit + integration on active branches.
- Weekly: full E2E on release candidate branch.
- Pre-release: full regression + smoke on fresh environment.
