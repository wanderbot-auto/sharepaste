# SharePaste VPS Deployment Guide

This guide is for running a real `server` on a VPS so macOS and Windows clients can test against a shared environment.

## Before you deploy

Current server/client transport is **insecure gRPC**:

- server uses `ServerCredentials.createInsecure()`
- clients use `credentials.createInsecure()`

Because of that, the recommended setup for real-device testing is:

1. Put the VPS and test devices on a private network such as Tailscale or WireGuard.
2. Bind the server to the VPS private address or keep `0.0.0.0` and only allow the private-network source range.
3. Do **not** expose port `50052` broadly to the public internet for long-lived testing.

If you need public access later, implement TLS on both server and clients first.

If you explicitly want a **single image with Postgres + Redis + server bundled together**, use:

- `Dockerfile.server-allinone`
- `compose.server-allinone.yml`
- `docs/ops/server-allinone-container.md`

That path is more convenient for short-lived VPS testing, but less clean than the split-service deployment described below.
For domestic-network environments, prefer building that image on a machine with stable network access, or override the base image through `BASE_IMAGE=<镜像源中的 node 基础镜像>`.
If you already have a mirrored Node image locally, you can also retag it first with `scripts/prepare-node-base-image.sh`.
For the all-in-one image workflow, the VPS side can now be reduced to `scripts/load-and-run-server-allinone.sh`.

## Minimum deployment shape

- Ubuntu/Debian-class VPS
- Node.js 20+
- Postgres 16+
- Redis 7+
- repo checked out at `/opt/sharepaste`
- durable mode enabled

## 1. Provision runtime dependencies

Example on Ubuntu:

```bash
sudo apt update
sudo apt install -y curl git build-essential redis-server postgresql postgresql-contrib
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify:

```bash
node -v
npm -v
psql --version
redis-server --version
```

## 2. Create database and service user

Example:

```bash
sudo -u postgres psql <<'SQL'
CREATE USER sharepaste WITH PASSWORD 'CHANGE_ME';
CREATE DATABASE sharepaste OWNER sharepaste;
\q
SQL
```

Redis can stay local-only for the first VPS test pass.

## 3. Check out the repo and install dependencies

```bash
sudo mkdir -p /opt/sharepaste
sudo chown "$USER":"$USER" /opt/sharepaste
git clone <your_repo_url> /opt/sharepaste
cd /opt/sharepaste
npm install
```

## 4. Configure the server environment

Copy the example file:

```bash
sudo mkdir -p /etc/sharepaste
sudo cp deploy/server/sharepaste-server.env.example /etc/sharepaste/server.env
sudo chown root:sharepaste /etc/sharepaste/server.env
sudo chmod 640 /etc/sharepaste/server.env
```

Edit `/etc/sharepaste/server.env`:

```env
NODE_ENV=production
SHAREPASTE_HOST=0.0.0.0
SHAREPASTE_PORT=50052
SHAREPASTE_STORAGE_MODE=durable
SHAREPASTE_DATABASE_URL=postgres://sharepaste:CHANGE_ME@127.0.0.1:5432/sharepaste
SHAREPASTE_REDIS_URL=redis://127.0.0.1:6379
```

## 5. Smoke-run the server manually

From the repo:

```bash
bash scripts/start-server-prod.sh
```

如果你把生产环境变量放在 `/etc/sharepaste/server.env`，也可以显式指定：

```bash
bash scripts/start-server-prod.sh --env-file /etc/sharepaste/server.env
```

如果提示 `Permission denied`，通常是因为当前登录用户无权读取该文件。
推荐做法是保持文件权限为 `root:sharepaste` + `640`，并用 `sharepaste` 服务用户执行验证，或直接通过 `systemd` 启动服务。

查看脚本中文帮助：

```bash
bash scripts/start-server-prod.sh --help
```

如果你希望临时覆盖 PostgreSQL / Redis 认证参数，也可以直接传参启动：

```bash
bash scripts/start-server-prod.sh \
  --host 0.0.0.0 \
  --port 50052 \
  --storage-mode durable \
  --db-host 127.0.0.1 \
  --db-port 5432 \
  --db-name sharepaste \
  --db-user sharepaste \
  --db-password 'CHANGE_ME' \
  --redis-host 127.0.0.1 \
  --redis-port 6379
```

Expected outcome:

- TypeScript server builds
- gRPC server starts
- log line prints `sharepaste server listening on ... (durable)`

At this point Postgres tables should auto-create on first boot.

## 6. Install the systemd service

Create the runtime user:

```bash
sudo useradd --system --home /opt/sharepaste --shell /usr/sbin/nologin sharepaste || true
sudo chown -R sharepaste:sharepaste /opt/sharepaste
```

Install the unit:

```bash
sudo cp deploy/server/sharepaste-server.service /etc/systemd/system/sharepaste-server.service
sudo systemctl daemon-reload
sudo systemctl enable sharepaste-server
sudo systemctl start sharepaste-server
```

Check status:

```bash
sudo systemctl status sharepaste-server
journalctl -u sharepaste-server -n 100 --no-pager
```

## 7. Network setup

Recommended:

- only allow your VPN/private-network CIDR to reach port `50052`
- keep Postgres and Redis bound to localhost

If using `ufw`, example:

```bash
sudo ufw allow from <private-network-cidr> to any port 50052 proto tcp
```

## 8. Client configuration

Point each client to the VPS address:

- macOS shell: set `SHAREPASTE_SERVER=<vps-ip>:50052`
- Windows shell: run `scripts/start-windows-client.ps1 -Server <vps-ip>:50052`

Prefer the private-network IP, not a public IP.

## 9. Real-environment validation pass

Run these in order:

1. Initialize device A on macOS.
2. Initialize or recover device B on Windows.
3. Bind Windows to macOS with a 6-digit bind code.
4. Verify both devices appear in the same device list.
5. Test text sync in both directions.
6. Test image sync in both directions.
7. Test file send/receive.
8. Remove one device and confirm access loss.
9. Restart the server and confirm device state still exists.
10. Re-test sync after reconnect.

## 10. Known gaps before broader exposure

- No TLS on server/client transport yet.
- No health endpoint implementation yet.
- No structured logging / request correlation implementation yet.
- Durable storage is still snapshot-style Postgres persistence, not the target domain-table design.
- Monitoring and alerting exist as docs, not as deployed dashboards/rules.

## Recommended next steps after first VPS validation

1. Add TLS support to server and clients.
2. Add a health check path or gRPC health service.
3. Add structured logs with request/device/group IDs.
4. Add a small smoke-test script for register/bind/sync/recover against the VPS.
