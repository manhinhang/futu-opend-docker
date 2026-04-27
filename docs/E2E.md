# Local end-to-end test

A `node:test` suite (`script/e2e.test.mjs`) that drives the published FutuOpenD container with **real credentials** and asserts the OpenAPI WebSocket layer is actually up. Local-only — credentials are passed in via env vars, not stored in the repo, not in CI.

## Why

The CI publish workflow's "validation" step (`.github/workflows/publish.yml:117`) accepts both exit code `0` _and_ `14` (login-failed) as a pass — it only checks that the binary starts. So today nothing in CI proves the image can log in, hash the password (`script/start.sh:6-8`), apply the XML template, mount the RSA key, or serve the OpenAPI port.

This test fills that gap. It catches:

- Broken `start.sh` sed replacements
- MD5 hashing regressions (`FUTU_ACCOUNT_PWD_MD5` was added in commit `bedcded`)
- XML template drift
- Upstream OpenD behavior changes after a version bump
- RSA pem mount/permission issues
- WebSocket / port-mapping configuration mistakes

CI keeps its existing exit-code gate; this test complements it locally.

## What it verifies

| #   | Test (line in `script/e2e.test.mjs`)                                       | Signal                                                                                     |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1   | `container is up and not in a failed state` (`:386`)                       | `docker inspect` health is not `unhealthy`/`missing`                                       |
| 2   | `FutuOpenD process is running inside the container` (`:393`)               | `pgrep FutuOpenD` succeeds                                                                 |
| 3   | `TCP API port is reachable from the host` (`:397`)                         | `net.connect` to `127.0.0.1:11111`                                                         |
| 4   | `logs do not contain a login-failure marker` (`:422`)                      | None of `login fail`, `密码错误`, `登录失败`, `verify code error` in `docker logs`         |
| 5   | `WebSocket handshake completes with HTTP 101 Switching Protocols` (`:436`) | Raw HTTP upgrade against `127.0.0.1:33333` returns `HTTP/1.1 101` + `Sec-WebSocket-Accept` |
| 6   | `container still up after API exercise`                                    | Health re-inspected post-handshake                                                         |

All 6 are active. A protobuf round-trip via the `futu-api` SDK was prototyped but didn't pan out on Node 24 — the prototype lives at `script/lib/_pending/futu-probe.mjs` and is not wired into the suite. See [Future work](#future-work).

The "ready" gate before tests run waits for OpenD's log line `>>>WebSocket监听地址:`, which is only printed _after_ successful login (`script/e2e.test.mjs` `READY_MARKER_RE`).

## Architecture

```text
e2e.test.mjs (before)
    │
    ├── preflight()              docker, futu.pem, opend_version.json, env-var creds
    │                             (or pre-populated .env.e2e)
    ├── readEnvCredentials() ── FUTU_ACCOUNT_ID / FUTU_ACCOUNT_PWD from process.env
    │   └── writeEnvFile()       .env.e2e (mode 0600)
    │                             • FUTU_ACCOUNT_ID / FUTU_ACCOUNT_PWD (login)
    │                             • LOCAL_RSA_FILE_PATH (host bind-mount)
    │                             • FUTU_OPEND_WEBSOCKET_PORT=33333 / FUTU_OPEND_WEBSOCKET_IP=0.0.0.0
    │                               (read by start.sh inside the container)
    │                             • FUTU_OPEND_VER (sourced from opend_version.json's
    │                               stableVersion; consumed by compose build.args)
    ├── composeUp() ──────────── docker compose --build                          (script/lib/docker.mjs)
    │                             -f docker-compose.yaml --env-file .env.e2e
    └── waitForReady()           tail logs → gate on >>>WebSocket监听地址 / fail-fast on >>>登录失败
                                 along the way: detect 2FA prompt → file-drop or TTY prompt
                                                → sendTelnetCommand() to port 22222 with CRLF

it() × 6

after → fullCleanup() → composeDown -v [+ rm .env.e2e if generated]
```

A single compose file (`docker-compose.yaml`) is used. Container env values come from compose-time interpolation (`${VAR:-default}` in the `environment:` block); a user-created `.env` (copied from the tracked `.env.example` template; the user-local `.env` is gitignored) is auto-loaded for the bare `docker compose up` case, and the e2e test passes `--env-file .env.e2e` to inject real creds + WebSocket settings. The compose file uses `network_mode: host` (and `build.network: host`) by default — verified necessary for OpenD's outbound to Futu on this setup; bridge networking silently produces `>>>登录失败,网络异常`.

## Prerequisites (one-time)

1. **Docker daemon running.**
2. **`FUTU_ACCOUNT_ID` and `FUTU_ACCOUNT_PWD` env vars set** in the shell that runs `npm run test:e2e`. The test reads them directly from `process.env` and writes the generated `.env.e2e` itself. Source them however you like — 1Password CLI, password manager, manual export. With the `op` CLI:

   ```bash
   export FUTU_ACCOUNT_ID=$(op read "op://<vault>/<item>/username")
   export FUTU_ACCOUNT_PWD=$(op read "op://<vault>/<item>/password")
   ```

   Replace `<vault>` and `<item>` with your own UUIDs (extract from your 1Password share URL: `&v=<vault>&i=<item>`). The test never invokes `op` — it has no opinion on where the values come from. If you can't set env vars in the launching shell (e.g. non-interactive agent), see the **Pre-populating .env.e2e** subsection below.

3. **`./futu.pem` exists with mode `0644`.**

   ```bash
   openssl genrsa -out futu.pem 1024
   chmod 0644 futu.pem
   ```

   `0600` will fail at runtime: the in-container `futu` user runs as a different UID than the host owner of the file, so it can't read a `0600`-mode bind mount. The test will start, OpenD will log `>>>API启用RSA: 否`, and Futu will reject the login.

4. **`node_modules/` not root-owned.** If a previous `npm install` ran as root, `npm install` will `EACCES`:

   ```bash
   sudo rm -rf node_modules package-lock.json
   ```

5. **`npm install`** — only the existing dependencies; the test has no extra runtime npm requirements.

## Quick start

```bash
# 1. Export creds in the shell. Source them however you like.
export FUTU_ACCOUNT_ID=$(op read "op://<vault>/<item>/username")
export FUTU_ACCOUNT_PWD=$(op read "op://<vault>/<item>/password")

# 2. Run the test.
npm install
npm run test:e2e

# 3. If OpenD prompts for an SMS verification code on first login,
#    drop the digits into /tmp/futu-sms-code:
echo 123456 > /tmp/futu-sms-code
```

Expected outcome on a healthy run: **6 passing**, ~30–60s total once the image is cached locally.

### Pre-populating `.env.e2e`

The test detects an existing `.env.e2e` and skips the env-var read entirely (`script/e2e.test.mjs:312-326`). Useful when:

- The shell launching `npm run test:e2e` can't export env vars (e.g. non-interactive agent runner).
- You want to source credentials from somewhere other than env vars (1Password file, manual paste, etc.).

Minimal `.env.e2e` template:

```bash
FUTU_ACCOUNT_ID=<your-account-id>
FUTU_ACCOUNT_PWD=<your-password>
LOCAL_RSA_FILE_PATH=/absolute/path/to/futu.pem
FUTU_OPEND_WEBSOCKET_PORT=33333
FUTU_OPEND_WEBSOCKET_IP=0.0.0.0
FUTU_OPEND_VER=10.4.6408   # mirror opend_version.json's stableVersion
```

Write it with mode `0600`. The test will leave a pre-populated `.env.e2e` alone on cleanup; only files it generated itself get unlinked.

## 2FA / SMS handling

OpenD requires an SMS verification code on first login from a new device, and Futu's "device whitelist" can wear off — be ready for it on most fresh runs.

The test detects the prompt by tailing `docker logs` for any of: `input_phone_verify_code`, `verify code`, `短信验证码`, `手机验证码` (`script/e2e.test.mjs:67`). It then routes the user response one of two ways:

- **TTY (`input.isTTY` true)**: standard `readline` prompt.
- **Non-TTY (Claude Code agent, CI runner, dmux pane)**: prints a banner and polls `/tmp/futu-sms-code`. Operator writes the digits to that file (`echo 123456 > /tmp/futu-sms-code`); the test consumes and `unlink`s it (`script/e2e.test.mjs:128-154`).

Either way, the code is **delivered to OpenD via telnet on port 22222** with `\r\n` line termination (`script/lib/docker.mjs` `sendTelnetCommand`). `docker attach` to PID 1 silently drops input on this image — telnet is the documented automation entrypoint per the README's "Method 2: telnet" section.

The 5-minute file-drop timeout is enough for a normal SMS round-trip; the overall `npm run test:e2e` timeout is 10 minutes.

## Module reference

| File                                 | Role                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `script/e2e.test.mjs`                | The `node:test` suite + `before/after` orchestration. Holds `waitForReady`, `wsHandshake`, `tcpProbe`, and the SMS handlers. Reads `FUTU_ACCOUNT_ID`/`FUTU_ACCOUNT_PWD` from env.                                                                                                                                                                                               |
| `script/start.sh`                    | Runs inside the container. Sed-substitutes the XML config; if `FUTU_OPEND_WEBSOCKET_PORT` is set, also uncomments `<websocket_port>` / `<websocket_ip>` to enable the WS listener.                                                                                                                                                                                              |
| `script/lib/docker.mjs`              | `composeUp`/`composeDown`, `inspectHealth`/`inspectExitCode`, `getLogs`, `pgrepFutuOpend`, `tailLogs(container, onLine)`, and `sendTelnetCommand(line)`.                                                                                                                                                                                                                        |
| `script/lib/_pending/futu-probe.mjs` | **Not active.** Stub for the future SDK round-trip experiment — references the `futu-api` npm package, which is intentionally not in `package.json`. See [Future work](#future-work).                                                                                                                                                                                           |
| `docker-compose.yaml`                | Single compose file. `network_mode: host` + `build.network: host` baked in; container env via `${VAR}` interpolation from `--env-file`.                                                                                                                                                                                                                                         |
| `package.json` (`test:e2e` script)   | `node --test --test-timeout=600000 script/e2e.test.mjs`                                                                                                                                                                                                                                                                                                                         |
| `script/e2e.k8s.test.mjs`            | Sibling harness for the [`k8s/`](../k8s/README.md) reference deployment. Two backends via `K8S_E2E_BACKEND`: `kind` (manifest-only — durable log signals, no live login) and `existing` (full e2e against the user's current `kubectl` context). The docker-compose harness is the canonical "FutuOpenD really logs in" test; the k8s harness is the manifest-equivalence test. |
| `script/lib/k8s.mjs`                 | `kind`/`kubectl`/port-forward helpers used by the k8s harness — `createKindCluster`, `kindLoadImage`, `tailKubectlLogs`, `startPortForward`, etc.                                                                                                                                                                                                                               |

### Module format

Active e2e files use ESM (`.mjs`) so they can `import` directly. The pre-existing unit test (`script/check_version.test.js`) is CJS; the boundary is intentional. New test code should follow ESM and use `.mjs`. Don't add `"type": "module"` to `package.json` until the unit test migrates.

### Tunable timeouts

`script/e2e.test.mjs` declares all timeouts in a single `TIMEOUTS` object near the top (`ready`, `tcpProbe`, `wsHandshake`, `smsDrop`). Adjust there if a slow connection or large image pull blows the budget.

### Debug logging

Set `E2E_DEBUG=1` in the environment to surface best-effort cleanup failures (`composeDown`, `unlink`) that are otherwise swallowed:

```bash
E2E_DEBUG=1 npm run test:e2e
```

## Known issues & gotchas

### Bridge network can fail apt-get during build

Docker Compose's default bridge network has flaky connectivity to `archive.ubuntu.com` on some local setups (timeouts/silent failures during `apt-get update`). The compose file works around this by setting `build.network: host` so apt uses the host's stack. CI publish builds (GitHub Actions) work without it; this is purely for local builds.

If you remove `build.network: host` and apt times out, restore it. The runtime image (`final-ubuntu`) is still based on `ubuntu:18.04` for FutuOpenD-binary compatibility, but the build stage is now `ubuntu:22.04` — bionic apt issues no longer apply because nothing apt-installs in the bionic runtime stage.

### Compose healthcheck is misconfigured

`docker-compose.yaml`'s healthcheck runs `bash -c '</dev/tcp/127.0.0.1/11111'` _inside_ the container — but OpenD binds the API to its hostname interface (per `<ip>` in the XML), not loopback. So the healthcheck stays in `starting` forever even when everything is up.

The test ignores it. Tests 1 and 6 only assert "not unhealthy" rather than `=healthy`. Long-term fix: change the healthcheck to use the bound interface (or pgrep + a short tcp check on the published interface) in `docker-compose.yaml`.

### Futu rate-limits rapid login retries

Multiple compose-ups in quick succession (or within a few minutes) trigger Futu's rate limiter, which returns `>>>登录失败,网络异常，请稍后再试` regardless of whether your credentials are correct. Wait 30+ minutes between aggressive debugging cycles. Account lockout threshold is roughly 10 wrong-password attempts; rate-limit messages don't appear to count against it but err on the side of caution.

### futu-api npm SDK Init times out (parked)

The active suite asserts the WS upgrade returns HTTP 101 — that's enough to prove the WebSocket layer is up. A full protobuf round-trip via the `futu-api` SDK was prototyped at `script/lib/_pending/futu-probe.mjs` but doesn't complete on Node 24 against this OpenD build: the WS handshake succeeds, but the SDK's protobuf-framed `Init` request gets no response and the client retries in a loop. Suspects in rough order: SDK frame format vs. OpenD expectations, `bytebuffer` interaction with Node's built-in `WebSocket`, or the SDK's published ESM packaging on Node 24's `--experimental-detect-module`.

`futu-api` is intentionally **not** in `package.json` — adding it back is the first step of any future debugging. To re-activate the experiment:

1. `npm install --save-dev futu-api`
2. Move `script/lib/_pending/futu-probe.mjs` back to `script/lib/futu-probe.mjs`
3. Either pin a known-good SDK + Node combination, or hand-roll the protobuf framing using `Common.proto` (44-byte header) and the `.proto` files shipped in `node_modules/futu-api/proto/`.

### Credentials can leak via debug commands

`docker compose config` and `docker exec <container> env` both print container env in plaintext, including `FUTU_ACCOUNT_PWD`. **Avoid both** when sharing your screen, pasting into a chat, or running in an agent session whose transcript persists. If credentials surface unintentionally, rotate the Futu password and update the 1Password item.

## Operational notes

- The test is **local-only**. CI keeps its existing exit-code gate (`.github/workflows/publish.yml`).
- Each successful run consumes one Futu login session. The whitelisted-device window is short — expect SMS prompts on most fresh runs.
- Cleanup runs in `after` and on `SIGINT`/`SIGTERM` (`script/e2e.test.mjs:363-373`); `Ctrl+C` mid-run won't leave a stray container or temp files. Pre-populated `.env.e2e` files are preserved (only generated ones get unlinked — see `ctx.envFileWasPreExisting`).

## Future work

- [ ] Re-activate the SDK round-trip test (`script/lib/_pending/futu-probe.mjs` → frame-format debugging or hand-rolled protobuf).
- [ ] Bump the runtime stage off Ubuntu 18.04. The build stage is already on jammy (commit `b6ac476`), but the final image stays bionic for FutuOpenD-binary compatibility. Test that the binary still runs on a newer libc base (jammy / debian:12).
- [ ] Fix the in-container healthcheck so test 1 and 6 can assert `=healthy` instead of `≠unhealthy`.
- [ ] Optional CI integration via 1Password service-account token (deferred from the original scope — service accounts can't read personal vaults, so this needs a shared-vault migration first).
