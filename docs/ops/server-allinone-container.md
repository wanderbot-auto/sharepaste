# SharePaste Server All-in-One Container

This is a **test-oriented** deployment shape for environments where you want a single image that can start directly without external Postgres or Redis.

The image includes:

- Node.js runtime
- SharePaste server
- PostgreSQL
- Redis

It is suitable for:

- internal cross-device testing
- short-lived VPS validation
- regions where pulling multiple public images is inconvenient

It is **not** the recommended long-term production shape.

## Why this exists

For some domestic VPS environments, the pain is usually:

- pulling multiple public images
- installing multiple services manually
- debugging Docker networking between app / Postgres / Redis

This image trades clean separation for operational simplicity:

- one image
- one container
- one persistent volume
- one startup command

## Build locally, then upload

Recommended flow for domestic VPS:

1. Build on a machine with stable network access.
2. Export the image as a tarball.
3. Upload it to the VPS.
4. `docker load` on the VPS.

Build:

```bash
docker build -f Dockerfile.server-allinone -t sharepaste/server-allinone:local .
```

Or use the helper script:

```bash
bash scripts/build-server-allinone-image.sh
```

## Domestic-network note

The most common failure in domestic VPS workflows is pulling the base image from Docker Hub.

The Dockerfile supports overriding the base image:

```bash
BASE_IMAGE=<your-mirrored-node-image> bash scripts/build-server-allinone-image.sh
```

Example pattern:

```bash
BASE_IMAGE=<registry-mirror>/node:20-bookworm-slim bash scripts/build-server-allinone-image.sh
```

That lets you:

- use a locally cached Node base image
- use a company/private registry mirror
- retag a preloaded Node image and build without depending on Docker Hub during the final build step

If you already have a mirrored or preloaded Node image locally, you can retag it to the default base image name:

```bash
bash scripts/prepare-node-base-image.sh <your-node-image>
```

Then build without passing `BASE_IMAGE` explicitly:

```bash
bash scripts/build-server-allinone-image.sh
```

Export:

```bash
docker save sharepaste/server-allinone:local | gzip > sharepaste-server-allinone.tar.gz
```

Or:

```bash
bash scripts/export-server-allinone-image.sh
```

Load on VPS:

```bash
gunzip -c sharepaste-server-allinone.tar.gz | docker load
```

After loading, start directly:

```bash
SHAREPASTE_PG_PASSWORD='CHANGE_ME' bash scripts/run-server-allinone-container.sh
```

## Run with Docker

```bash
docker run -d \
  --name sharepaste-server \
  --restart unless-stopped \
  -p 50052:50052 \
  -v sharepaste-allinone-data:/var/lib/sharepaste \
  -e SHAREPASTE_PG_USER=sharepaste \
  -e SHAREPASTE_PG_PASSWORD='CHANGE_ME' \
  -e SHAREPASTE_PG_DB=sharepaste \
  -e SHAREPASTE_REDIS_PASSWORD='' \
  sharepaste/server-allinone:local
```

Or:

```bash
SHAREPASTE_PG_PASSWORD='CHANGE_ME' bash scripts/run-server-allinone-container.sh
```

## Shortest domestic-VPS workflow

On a machine with better network access:

```bash
bash scripts/prepare-node-base-image.sh <your-node-image-or-mirror>
bash scripts/build-server-allinone-image.sh
bash scripts/export-server-allinone-image.sh
```

Upload `sharepaste-server-allinone.tar.gz` to the VPS, then on the VPS:

```bash
SHAREPASTE_PG_PASSWORD='CHANGE_ME' bash scripts/load-and-run-server-allinone.sh sharepaste-server-allinone.tar.gz
```

Or use the one-shot VPS helper:

```bash
SHAREPASTE_PG_PASSWORD='CHANGE_ME' bash scripts/load-and-run-server-allinone.sh sharepaste-server-allinone.tar.gz
```

## Run with Compose

```bash
docker compose -f compose.server-allinone.yml up -d --build
```

## Container behavior

On startup the container will:

1. initialize PostgreSQL data if needed
2. start PostgreSQL bound to `127.0.0.1`
3. create/update the SharePaste database user and database
4. start Redis bound to `127.0.0.1`
5. start SharePaste server in `durable` mode

Persistent data lives under:

```text
/var/lib/sharepaste
```

## Key environment variables

- `SHAREPASTE_HOST`
- `SHAREPASTE_PORT`
- `SHAREPASTE_STORAGE_MODE`
- `SHAREPASTE_PG_USER`
- `SHAREPASTE_PG_PASSWORD`
- `SHAREPASTE_PG_DB`
- `SHAREPASTE_PG_PORT`
- `SHAREPASTE_REDIS_PORT`
- `SHAREPASTE_REDIS_PASSWORD`
- `SHAREPASTE_DATA_ROOT`

The entrypoint also supports:

```bash
docker run --rm sharepaste/server-allinone:local --help
```

## Important limitations

- The current gRPC transport is still insecure.
- Do not expose `50052` broadly to the public internet for long-lived use.
- Prefer VPN / private-network access for Windows and macOS client testing.
- Postgres and Redis are inside the same container, so this is intentionally a convenience setup, not a high-availability setup.
