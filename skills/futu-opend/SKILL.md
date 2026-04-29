---
name: futu-opend
description: |
  Install AND operate FutuOpenD via the futu-opend-docker image.
  Use when the user asks to install, set up, deploy, run, restart, recover,
  re-login, send the SMS / 2FA / verification code to, troubleshoot, bump the
  version of, switch the base image of, or tear down FutuOpenD / futu-opend /
  futu-opend-docker on docker compose, plain docker, or Kubernetes.
  Triggers: "install FutuOpenD", "set up Futu OpenD", "run futu-opend-docker",
  "deploy FutuOpenD on kubernetes", "restart futu-opend", "re-login to Futu",
  "send the SMS code to futu", "futu container is unhealthy", "wipe Futu
  session", "bump FUTU_OPEND_VER", "switch ubuntu/centos image",
  "tear down futu-opend".
---

# FutuOpenD installer & operator

This skill is the runbook for installing and operating FutuOpenD via this
repo's image. Drive the work yourself; only stop for inputs you cannot
infer (account id, password, SMS code, target choice). Do not duplicate the
docs — link to them. Source-of-truth files cited inline below.

## Vocabulary

- **Target** — `compose` (default when cwd is this repo), `docker-run`
  (no compose), or `k8s` (Kubernetes manifests under `k8s/`).
- **Data volume** — `futu-opend-data` named volume mounted at
  `/home/futu/.com.futunn.FutuOpenD`. Holds the device-whitelist token and
  CAPTCHA PNG. Wiping it forces a fresh SMS prompt on next login.
- **Telnet port** — `22222`. The 2FA delivery channel (CRLF-terminated
  commands). Distinct from the API port `11111`.

## Phase A — classify the request

Before asking the user anything, observe the world. Pick exactly one branch
below from what you see:

```bash
# In a clone of this repo:
docker ps --filter name=futu-opend --format '{{.Names}}\t{{.Status}}'
docker compose ps --format json 2>/dev/null
# If the user mentioned k8s, or kubectl is on PATH and points somewhere:
kubectl get pods -n futu-opend 2>/dev/null
```

- **Nothing running, no `.env`, no `futu.pem`** → first-time **install**.
  Go to Phase B(install).
- **Container/pod exists** but the user wants to restart, re-login, bump
  version, tail logs, or wipe state → **operate**. Go to Phase B(ops),
  load `references/operations.md`, and pick the matching runbook entry.
- **Container/pod exists with errors** (CrashLoopBackOff, `>>>登录失败`,
  `>>>API启用RSA: 否`, `Health: unhealthy`, EACCES on the data volume) →
  **troubleshoot**. Load `references/troubleshooting.md` and match the
  symptom before changing anything.

If the user's wording is unambiguous (e.g. "install on k8s", "send SMS
code 123456"), trust it — don't re-ask.

## Phase B(install) — first-time setup

### 1. Pick the target

Default to `compose` when the cwd is this repo. Use AskUserQuestion only
when ambiguous (e.g. user says "deploy futu-opend" with no further
context). Match the wording: "compose" / "kubernetes" / "k8s" /
"docker run" / "no compose".

### 2. Preflight

Required tools by target:

| Target       | Tools                                                   |
| ------------ | ------------------------------------------------------- |
| `compose`    | `docker`, `docker compose`, `openssl`, `telnet` or `nc` |
| `docker-run` | `docker`, `openssl`, `telnet` or `nc`                   |
| `k8s`        | `kubectl`, `openssl`, `telnet` or `nc`                  |

Probe with `command -v <tool>`. If anything is missing, surface it with a
one-line install hint (e.g. `apt-get install -y telnet`) and stop.

### 3. Generate `futu.pem` (RSA key)

```bash
openssl genrsa -out futu.pem 1024
chmod 0644 futu.pem   # not 0600 — see references/troubleshooting.md
```

If `futu.pem` already exists, **do not overwrite without confirmation**.
Verify the existing file is mode `0644`; if it's `0600`, run `chmod 0644`
and explain why (the in-container `futu` UID can't read root-owned `0600`
files; `>>>API启用RSA: 否` is the silent-failure signature).

### 4. Collect credentials

Ask for `FUTU_ACCOUNT_ID` and the account password (one-time). Compute the
MD5 hash locally and only persist the hash:

```bash
read -rsp 'Futu password: ' FUTU_ACCOUNT_PWD; echo
FUTU_ACCOUNT_PWD_MD5=$(printf '%s' "$FUTU_ACCOUNT_PWD" | md5sum | awk '{print $1}')
unset FUTU_ACCOUNT_PWD
```

Hard rules:

- Never `echo` the plaintext password to a tool result, log, or shell history.
- Never run `docker compose config` or `docker exec <container> env` —
  both leak `FUTU_ACCOUNT_PWD` and (less catastrophically) the MD5 hash.
- Prefer `FUTU_ACCOUNT_PWD_MD5` everywhere. The plaintext form is a
  deprecated legacy fallback and `start.sh` emits a stderr warning when
  only the plaintext is set (see `script/start.sh:6-11`).

### 5. Materialize config and bring it up

Branch into the target's reference file and follow it end-to-end:

- compose → `references/install-compose.md`
- docker run → `references/install-docker-run.md`
- k8s → `references/install-k8s.md`

### 6. Watch logs for the 2FA prompt

| Target       | Command                                               |
| ------------ | ----------------------------------------------------- |
| `compose`    | `docker compose logs -f futu-opend`                   |
| `docker-run` | `docker logs -f futu-opend-docker`                    |
| `k8s`        | `kubectl -n futu-opend logs -f deployment/futu-opend` |

Look for these signals:

- `>>>API启用RSA: 是` → RSA loaded. Good.
- `>>>API启用RSA: 否` → `futu.pem` permissions wrong. Stop and fix
  (`references/troubleshooting.md`).
- `input_phone_verify_code` prompt → SMS required. Go to step 7.
- `input_pic_verify_code` prompt → CAPTCHA required. See
  `references/two-factor.md`, "Picture CAPTCHA".
- `>>>登录失败,网络异常` ~45 s after login → bridge networking, not host.
  Stop. (`references/troubleshooting.md`).

### 7. Deliver the SMS code (or CAPTCHA)

When the prompt appears, ask the user for the 6-digit code. Do not log it.
Send it via the route from `references/two-factor.md` matching the target.
CRLF (`\r\n`) is mandatory; bare LF is silently dropped.

Quick reference for SMS:

```bash
# compose / docker-run (telnet on host, port 22222):
echo "input_phone_verify_code -code=<CODE>" | telnet localhost 22222
# Or, telnet not installed:
printf 'input_phone_verify_code -code=<CODE>\r\n' | nc -w 2 localhost 22222

# k8s (no port-forward needed):
kubectl exec -n futu-opend deployment/futu-opend -- \
  bash -c 'printf "input_phone_verify_code -code=<CODE>\r\n" > /dev/tcp/127.0.0.1/22222'
```

### 8. Verify

The shipped TCP healthcheck is broken (compose targets `127.0.0.1:11111`
but OpenD binds the hostname-resolved interface). **Never** assert
`Health.Status == "healthy"`. Use these instead:

```bash
# compose / docker-run:
docker exec futu-opend pgrep -a FutuOpenD          # process up
docker compose logs --tail=200 futu-opend | grep -E '>>>API监听地址|>>>Telnet监听地址|登录'

# k8s:
kubectl exec -n futu-opend deployment/futu-opend -- pgrep -a FutuOpenD
kubectl -n futu-opend logs deployment/futu-opend --tail=200 | grep -E '>>>API监听地址|登录'
```

Pass criteria: `pgrep` finds `FutuOpenD`, logs contain `>>>API监听地址`,
no `>>>登录失败` lines after the latest login attempt.

### 9. Hand off

Print to the user:

- API endpoint: host: from `FUTU_OPEND_IP`, port: `FUTU_OPEND_PORT` (default `11111`).
- Telnet endpoint: same host, port: `FUTU_OPEND_TELNET_PORT` (default `22222`).
- WebSocket endpoint (only if `FUTU_OPEND_WEBSOCKET_PORT` was set).
- Path to `futu.pem` for the API client.
- One-line pointer: "If something breaks, see `references/troubleshooting.md`."

## Phase B(ops) — operate an existing deployment

Load `references/operations.md` and pick the runbook entry that matches
the user's wording. If unclear, use AskUserQuestion with these options
(re-deliver SMS / restart / tail logs / bump version / switch base image
/ teardown / wipe session / status). Common ops:

- **Status** — `docker compose ps` + `pgrep` inside, or `kubectl get pods,svc,pvc -n futu-opend`.
- **Re-login / SMS re-prompt** — same as Phase B(install) step 7.
- **Restart, preserving session** — `docker compose restart futu-opend`,
  or `kubectl -n futu-opend rollout restart deployment/futu-opend`.
- **Wipe session (forces SMS)** — `docker compose down -v` (compose) or
  `kubectl -n futu-opend scale deployment/futu-opend --replicas=0 &&
kubectl -n futu-opend delete pvc futu-opend-data && kubectl -n
futu-opend scale deployment/futu-opend --replicas=1` (k8s). **Always
  confirm** — this costs a fresh SMS code on the next start.
- **Version bump** — change `FUTU_OPEND_VER` in `.env` (compose), the
  image tag in `deployment.yaml` (k8s), or the `docker run` image tag.
  `opend_version.json` is the source of truth for the current stable.
- **Switch ubuntu↔centos** — change the GHCR tag suffix (`ubuntu-stable`
  → `centos-stable`) or the `--target` flag for local builds.
- **Tear down** — `docker compose down` (keeps session) vs. `down -v`
  (wipes), or `kubectl delete -k k8s/` plus an explicit `kubectl delete
pvc/secret`. Always make data-loss explicit.

## Phase B(troubleshoot)

Load `references/troubleshooting.md` and match the observed symptom
before changing anything. Common ones (full table in the reference):

- `>>>登录失败,网络异常` ~45 s after login → not host networking.
- `>>>API启用RSA: 否` → `futu.pem` is `0600`, not `0644`.
- EACCES on `/home/futu/.com.futunn.FutuOpenD` → pre-PR-65 volume; wipe.
- Healthcheck stuck in `starting` → expected (broken probe). Use `pgrep`.
- "Network anomaly" after rapid retries → Futu rate-limit. Wait 30+ min.

## Source-of-truth files

The skill defers to these — they are not duplicated here:

- `README.md` — user-facing install + verification recipes.
- `k8s/README.md` — k8s install + first-run SMS/CAPTCHA via kubectl.
- `CLAUDE.md` — critical gotchas. Re-read on every troubleshoot.
- `AGENTS.md` — file map, conventions, anti-patterns.
- `docs/E2E.md` — e2e harness (test-only, not for production install).
- `script/start.sh` — runtime brain; XML templating + MD5 hashing.
- `docker-compose.yaml` — compose orchestration manifest.
- `k8s/deployment.yaml`, `k8s/kustomization.yaml`, `k8s/secret.example.yaml`.
- `opend_version.json` — current stable/beta version.
