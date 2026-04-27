# PROJECT KNOWLEDGE BASE

**Generated:** 2026-04-26T08:48:32Z
**Commit:** b800b90
**Branch:** main
**Companion file:** see [CLAUDE.md](CLAUDE.md) for Claude Code workflow tips, daily commands, and operational gotchas; this file owns the structure tables, conventions, and reference data.

## OVERVIEW

Docker containerization for Futu OpenD — a trading API gateway for Futu Securities. Multi-arch builds (Ubuntu/CentOS) with automated version tracking and CI/CD to GHCR.

## STRUCTURE

```text
.
├── Dockerfile              # Multi-stage build (final-ubuntu-target / final-centos-target)
├── docker-compose.yaml     # Local dev compose (host net + futu-opend-data volume)
├── FutuOpenD.xml           # Config template (sed-replaced at runtime)
├── opend_version.json      # Version tracking (auto-updated by CI)
├── package.json            # npm scripts: test:unit, test:e2e (jsdom dep)
├── .env.example            # Tracked template — `cp .env.example .env`, then fill in creds (.env is gitignored)
├── docs/
│   └── E2E.md              # End-to-end test harness deep-dive
├── k8s/                    # Reference k8s deployment + harness backend (kind/existing)
│   ├── README.md           # Deploy + first-run SMS/CAPTCHA via kubectl, plus local-dev kind flow
│   ├── deployment.yaml     # Single-replica, hostNetwork, init-chown, 0644 RSA, pgrep liveness
│   ├── pvc.yaml            # 1Gi RWO PVC for /home/futu/.com.futunn.FutuOpenD
│   ├── namespace.yaml      # futu-opend namespace
│   ├── secret.example.yaml # Reference Secret template (NOT applied via kustomize)
│   ├── kustomization.yaml  # namespace + pvc + deployment
│   └── kind-config.yaml    # Local-dev kind cluster (used by npm run test:k8s)
├── script/
│   ├── start.sh            # Entrypoint — replaces XML placeholders, MD5s password
│   ├── download_futu_opend.sh  # Downloads FutuOpenD tarball (3 attempts total, fixed 2 s delay between retries)
│   ├── check_version.js    # Version scraper with retry, timeout, validation
│   ├── check_version.test.js   # Unit tests (node:test, CJS)
│   ├── e2e.test.mjs        # E2E suite (node:test, ESM, 6 assertions, live OpenD)
│   ├── e2e.k8s.test.mjs    # K8s manifest-equivalence harness (ESM, kind|existing backend)
│   └── lib/
│       ├── docker.mjs      # compose / inspect / telnet helpers (ESM)
│       ├── k8s.mjs         # kind / kubectl / port-forward helpers (ESM)
│       └── _pending/       # Parked: futu-api SDK round-trip experiment (not active)
└── .github/workflows/      # CI: publish, lint, version-check, auto-merge
```

## WHERE TO LOOK

| Task                   | Location                                                          | Notes                                                                                        |
| ---------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Add build arg          | `Dockerfile` (FUTU_OPEND_VER ARG sites)                           | Default `9.3.5308` is legacy; CI passes explicit value                                       |
| Modify startup         | `script/start.sh`                                                 | XML sed replacement + MD5 hashing happens here                                               |
| Change CI triggers     | `.github/workflows/publish.yml`                                   | Matrix: BASE_IMG × VERSION → GHCR                                                            |
| Update config template | `FutuOpenD.xml`                                                   | Placeholders: `<api_port>`, `<login_pwd_md5>`, etc.                                          |
| Version detection      | `script/check_version.js`                                         | Scraper with retry, timeout, validation                                                      |
| Run unit tests         | `script/check_version.test.js`                                    | `npm run test:unit`                                                                          |
| Run e2e suite          | `script/e2e.test.mjs`                                             | `npm run test:e2e`; needs creds + `futu.pem` (see docs/E2E.md)                               |
| Run k8s e2e            | `script/e2e.k8s.test.mjs`                                         | `npm run test:k8s` (kind = manifest-only) or `K8S_E2E_BACKEND=existing npm run test:k8s`     |
| Deploy on k8s          | `k8s/`                                                            | `kubectl apply -k k8s/`; SMS/CAPTCHA flow at [k8s/README.md](k8s/README.md)                  |
| Compose helpers (Node) | `script/lib/docker.mjs`                                           | `composeUp`, `sendTelnetCommand`, `tailLogs`, `inspectHealth`                                |
| K8s helpers (Node)     | `script/lib/k8s.mjs`                                              | `createKindCluster`, `kindLoadImage`, `tailKubectlLogs`, `startPortForward`                  |
| Enable WebSocket       | `script/start.sh` (websocket section)                             | Set `FUTU_OPEND_WEBSOCKET_PORT` (default disabled)                                           |
| Persist login session  | `docker-compose.yaml` `futu-opend-data`                           | Mounted at `/home/futu/.com.futunn.FutuOpenD`                                                |
| Tweak compose env      | `.env` (auto-loaded; copy from `.env.example`) / `.env.e2e` (e2e) | `FUTU_OPEND_VER` mirrors `opend_version.json` stable                                         |
| Add npm script         | `package.json`                                                    | Currently `test:unit`, `test:e2e`                                                            |
| Download manually      | `bash script/download_futu_opend.sh <tarball>`                    | Single positional arg, e.g. `Futu_OpenD_10.4.6408_Ubuntu18.04.tar.gz`; retries 3× internally |

## CONVENTIONS

- **Multi-stage Docker**: `final-ubuntu-target` / `final-centos-target` selected by build `--target`; the unparameterised `final` alias defaults to Ubuntu. The `BASE_IMG` build arg is declared but no longer routes between targets — pass `--target` explicitly.
- **Non-root user**: All images run as `futu` user (created at build).
- **Env var injection**: `FUTU_ACCOUNT_ID`, `FUTU_ACCOUNT_PWD`, `FUTU_ACCOUNT_PWD_MD5` (priority over PWD), `FUTU_OPEND_RSA_FILE_PATH`, `FUTU_OPEND_IP`, `FUTU_OPEND_PORT` (11111), `FUTU_OPEND_TELNET_PORT` (22222), `FUTU_OPEND_WEBSOCKET_PORT` / `FUTU_OPEND_WEBSOCKET_IP` (optional).
- **Password hashing**: MD5 of password computed at runtime by `start.sh` if `FUTU_ACCOUNT_PWD_MD5` is unset.
- **Version tracking**: `opend_version.json` updated by scheduled CI; triggers PR on change.
- **ESM boundary**: e2e code is `.mjs` (ESM); `check_version.test.js` stays CJS. Don't add `"type": "module"` to `package.json` until that migrates.
- **Module conventions**: `script/lib/_pending/` holds parked experiments; never import from there in shipping code.

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER** run containers as root — `USER futu` enforced.
- **NEVER** hardcode credentials — use env vars or your local (gitignored) `.env` file. The tracked `.env.example` template must stay credential-free.
- **NEVER** modify `FutuOpenD.xml` directly — it's a template; changes are overwritten by `sed` at runtime.
- **NEVER** skip RSA key — required for API encryption.
- **NEVER** swap `network_mode: host` for bridge — silent login failure (`>>>登录失败,网络异常` ~45 s in). See [CLAUDE.md](CLAUDE.md) gotchas.
- **NEVER** ship `futu.pem` at mode `0600` to users — runtime UID mismatch breaks RSA. `docs/E2E.md` calls out 0644 explicitly (the README is silent on file mode).
- **NEVER** assert healthcheck `= healthy` — known-broken (TCP probe targets loopback, OpenD binds hostname). Assert `≠ unhealthy`.
- **NEVER** run `docker compose config` or `docker exec ... env` in shared sessions — leaks `FUTU_ACCOUNT_PWD`.
- **NEVER** import `futu-api` from `script/lib/_pending/` — intentionally not in `package.json`.

## UNIQUE STYLES

- **XML templating**: `sed -i` replaces placeholder patterns in `FutuOpenD.xml` at container start.
- **Dual base images**: Ubuntu 18.04 (bionic, runtime) / CentOS 7 (runtime); build stages on Ubuntu 22.04 / CentOS 7 — bionic apt is bypassed for build reliability.
- **Healthcheck split**: The Dockerfile-shipped healthcheck is `pgrep FutuOpenD` (works). The compose override is a TCP probe on `127.0.0.1:11111`, which is misconfigured (loopback vs. hostname bind) and stays in `starting` — see [CLAUDE.md](CLAUDE.md) gotchas.
- **2FA flow**: SMS code delivery — telnet to port `22222` (preferred), `docker attach` interactive (`input_phone_verify_code -code=XXXXXX`), or e2e file-drop at `/tmp/futu-sms-code` for non-TTY runs. K8s equivalents — `kubectl port-forward` + telnet, or `kubectl exec ... -- bash -c 'printf "...\r\n" > /dev/tcp/127.0.0.1/22222'`. See [k8s/README.md](k8s/README.md) "First-run login".
- **Login session persistence**: Named volume `futu-opend-data` at `/home/futu/.com.futunn.FutuOpenD`; the Dockerfile pre-creates the path with `futu:futu` ownership for first-mount inheritance.

## COMMANDS

> Day-to-day commands (build, compose, attach, test, version scrape, SMS delivery) live in [CLAUDE.md](CLAUDE.md). Update both files together when adding a workflow command.

## VERSIONS & PORTS

| Fact                        | Value                                  | Source of truth                                |
| --------------------------- | -------------------------------------- | ---------------------------------------------- | --------------------------- |
| Stable OpenD                | 10.4.6408                              | `opend_version.json`                           | <!-- futu-opend-version --> |
| Beta OpenD                  | null                                   | `opend_version.json`                           |
| Build-arg default           | 9.3.5308                               | `Dockerfile` (legacy default; CI passes value) |
| `.env.example` default      | 10.4.6408                              | `.env.example` (mirrors stable on bumps)       | <!-- futu-opend-version --> |
| Runtime base (Ubuntu)       | `ubuntu:18.04` (bionic, binary compat) | `Dockerfile`                                   |
| Build base (Ubuntu)         | `ubuntu:22.04` (jammy, apt works)      | `Dockerfile`                                   |
| Runtime/build base (CentOS) | `centos:centos7`                       | `Dockerfile`                                   |
| API port                    | 11111                                  | env `FUTU_OPEND_PORT`                          |
| Telnet/2FA port             | 22222                                  | env `FUTU_OPEND_TELNET_PORT`                   |
| WebSocket port (optional)   | 33333 (e2e default; opt-in)            | env `FUTU_OPEND_WEBSOCKET_PORT`                |

## E2E TEST HARNESS

Local-only `node:test` suite that drives a real login. CI keeps its existing exit-code gate.

- **Entrypoint**: `script/e2e.test.mjs` — 6 assertions (health ≠ unhealthy, `pgrep`, TCP `11111`, no login-failure markers, WebSocket HTTP `101` on `33333`, post-test health).
- **Helpers**: `script/lib/docker.mjs` — `composeUp`, `composeDown`, `sendTelnetCommand`, `tailLogs`, `inspectHealth`, `waitForHealthy`.
- **Inputs**: `FUTU_ACCOUNT_ID` / `FUTU_ACCOUNT_PWD` env vars, or pre-populated `.env.e2e` (mode `0600`).
- **2FA**: telnet to `22222` with CRLF; non-TTY drop at `/tmp/futu-sms-code` polled every 1 s (5 min budget).
- **Ready signal**: log marker `>>>WebSocket监听地址` (post-login) plus TCP probes on `11111` and `33333`.
- **Run**: `npm run test:e2e` (10-minute overall budget).
- **Full prerequisites & architecture**: see [docs/E2E.md](docs/E2E.md).

## NOTES

- **RSA key required**: Generate with `openssl genrsa -out futu.pem 1024`, then `chmod 0644 futu.pem` (the implicit `0600` from `genrsa` breaks the in-container `futu` UID — see [CLAUDE.md](CLAUDE.md) gotchas).
- **Slow startup**: FutuOpenD takes 2–3 minutes to initialize; the Dockerfile healthcheck has a 180 s grace period. The compose healthcheck is misconfigured — see UNIQUE STYLES.
- **2FA required**: First run needs SMS code input. See `## E2E TEST HARNESS` and CLAUDE.md gotchas for the three delivery routes.
- **Tests**: `npm run test:unit` (`node --test script/check_version.test.js`) and `npm run test:e2e` (`node --test --test-timeout=600000 script/e2e.test.mjs`).
- **Download**: `bash script/download_futu_opend.sh <tarball-name>` (single positional argument; the script attempts up to 3 times with a fixed 2 s delay between retries).
- **Login session persistence**: `futu-opend-data` named volume avoids SMS re-prompt across container recreate. Wipe with `docker compose down -v`. See [README.md](README.md) "Login session persistence" for the full story.
- **Disclaimer**: Not affiliated with Futu Securities.
