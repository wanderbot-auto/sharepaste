# SharePaste Release Checklist

## Pre-release
- [ ] `npm run lint` passes.
- [ ] `npm test` passes.
- [ ] `npm run build` passes.
- [ ] No open P0 defects.
- [ ] P1 defects are <= 3 with documented workaround.

## Pilot gate
- [ ] Core paths validated: init, bind, sync, remove, recover.
- [ ] Durable mode smoke test passed with Postgres + Redis.
- [ ] Monitoring and alert rules configured.
- [ ] Rollback command and owner on duty confirmed.

## Rollback
1. Stop current server deployment.
2. Redeploy previous stable version.
3. Verify health and core paths.
4. Communicate pilot status and incident summary.
