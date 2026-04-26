# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project at a glance

Docker container for **FutuOpenD** — Futu Securities' trading API gateway. Multi-stage build with Ubuntu 18.04 / CentOS 7 runtime images, published to GHCR. For the project knowledge base (file map, conventions, anti-patterns) see [AGENTS.md](AGENTS.md); for the e2e harness deep-dive see [docs/E2E.md](docs/E2E.md).

## Common commands

```bash
# Build locally (Ubuntu runtime — default)
docker build -t futu-opend-docker \
  --build-arg FUTU_OPEND_VER=10.4.6408 \
  --target final-ubuntu-target .

# Build locally (CentOS runtime)
docker build -t futu-opend-docker \
  --build-arg FUTU_OPEND_VER=10.4.6408 \
  --target final-centos-target .

# Run with compose (uses .env + ./futu.pem)
docker compose up -d
docker compose logs -f futu-opend
docker compose down            # preserves the futu-opend-data volume
docker compose down -v         # wipes the persisted login session

# Single unit test
node --test script/check_version.test.js
npm run test:unit              # alias for the line above

# Full e2e suite (real login, ~10 min budget). See docs/E2E.md for prereqs.
npm run test:e2e

# Scrape Futu's download page for new versions
node script/check_version.js

# Manually fetch the FutuOpenD tarball
bash script/download_futu_opend.sh Futu_OpenD_10.4.6408_Ubuntu18.04.tar.gz

# Deliver SMS 2FA via telnet (preferred for automation; `docker attach` is the
# interactive alternative — see README Method 1)
echo "input_phone_verify_code -code=XXXXXX" | telnet localhost 22222

# Deliver SMS 2FA to the e2e harness when running non-TTY (CI / agent)
echo 123456 > /tmp/futu-sms-code
```

## Architecture: read these files in order

1. **`Dockerfile`** — multi-stage. Build stages on `ubuntu:22.04` / `centos:centos7`; runtime stages on `ubuntu:18.04` (bionic, binary compat) / `centos:centos7`. Targets `final-ubuntu-target` (default for compose and the `final` alias) and `final-centos-target`. Each runtime stage creates the non-root `futu` user and pre-creates `/home/futu/.com.futunn.FutuOpenD` so a named volume mount inherits `futu:futu` ownership.
2. **`script/start.sh`** — runtime brain. `sed`-templates `FutuOpenD.xml` (placeholders like `<api_port>`, `<rsa_private_key>`), MD5-hashes `FUTU_ACCOUNT_PWD` if `FUTU_ACCOUNT_PWD_MD5` is unset, conditionally enables WebSocket when `FUTU_OPEND_WEBSOCKET_PORT` is set, then launches `/bin/FutuOpenD -cfg_file=/tmp/FutuOpenD.xml` as a child process (no `exec` builtin — bash stays as PID 1, which means signals to the container are not forwarded to FutuOpenD).
3. **`docker-compose.yaml`** — `network_mode: host` (mandatory; bridge silently fails) plus the named volume `futu-opend-data` for login session persistence. Healthcheck is a TCP probe on `127.0.0.1:11111` (see gotcha below).
4. **`script/e2e.test.mjs` + `script/lib/docker.mjs`** — local-only `node:test` e2e suite. 6 assertions, telnet-based 2FA delivery, file-drop fallback for non-TTY runs. Full architecture in [docs/E2E.md](docs/E2E.md).
5. **`.github/workflows/publish.yml`** — matrix CI (`BASE_IMG` × `FUTU_OPEND_VER`) → GHCR. A `dorny/paths-filter` step skips the build when changes are limited to `README.md`, `LICENSE`, `.github/workflows/check-ver-update.yml`, or `.github/workflows/lint.yml`.

## Critical gotchas

- **Host network is mandatory.** Bridge networking produces `>>>登录失败,网络异常` ~45 s after login attempt with healthy creds. Both `network_mode: host` and `build.network: host` are set in `docker-compose.yaml`; do not flip them without a verified replacement.
- **`futu.pem` must be mode `0644`, not `0600`.** The container runs as the `futu` UID, distinct from the host user that owns the bind-mounted file. `0600` silently disables RSA (`>>>API启用RSA: 否`) and Futu rejects login.
- **Named volume `futu-opend-data`** at `/home/futu/.com.futunn.FutuOpenD` persists the login session (device-whitelist token, captcha PNG). The current Dockerfile pre-creates that path with `futu:futu` ownership so a fresh mount inherits the right uid; pre-PR-65 images didn't, so a volume created against an older image will keep its root-owned mount point and fail with EACCES on first write. Fix with `docker compose down -v` (wipes the volume — costs the cached login session, requires a fresh SMS code on next start). `docker compose pull` does **not** help: this compose file builds locally (no `image:` directive) and the volume's contents are preserved across image bumps.
- **Compose healthcheck stays in `starting` forever.** It runs `</dev/tcp/127.0.0.1/11111`, but FutuOpenD binds the hostname-resolved interface (set by `FUTU_OPEND_IP=0.0.0.0`), not loopback. Tests should assert `state.Health.Status != "unhealthy"`, never `== "healthy"`. The Dockerfile-shipped healthcheck is `pgrep FutuOpenD` — use that as ground truth.
- **2FA / SMS delivery** has three routes: (1) telnet to port `22222` with CRLF — preferred for automation; (2) `docker attach futu-opend` for interactive use; (3) e2e harness file-drop at `/tmp/futu-sms-code` for non-TTY runs.
- **Two password env vars; MD5 wins.** `FUTU_ACCOUNT_PWD_MD5` takes priority over `FUTU_ACCOUNT_PWD`; if only the plaintext is set, `start.sh` MD5-hashes it at runtime.
- **Avoid `docker compose config` and `docker exec <container> env`** — both leak `FUTU_ACCOUNT_PWD` in plaintext.
- **Futu rate-limits rapid login retries.** Wait 30+ minutes between aggressive debug cycles; rate-limit messages look identical to network errors.

## Pointers

- Project knowledge base (file map, conventions, anti-patterns, version/port reference) → [AGENTS.md](AGENTS.md)
- E2E harness deep-dive (architecture, prerequisites, 2FA handling, troubleshooting) → [docs/E2E.md](docs/E2E.md)
- User-facing usage (image tags, prerequisites, login flow) → [README.md](README.md)
