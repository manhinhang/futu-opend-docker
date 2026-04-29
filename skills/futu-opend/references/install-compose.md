# Install — `docker compose` (default)

Use this when the cwd is a clone of `futu-opend-docker`. Mirrors
[`README.md`](../../../README.md) "Run in docker compose" and
[`docker-compose.yaml`](../../../docker-compose.yaml).

## Steps

1. **Copy the env template, then fill in creds.**

   ```bash
   cp .env.example .env
   ```

   Edit `.env` with the `Edit` tool — never `echo` plaintext into the file
   (it lands in shell history). Fill `FUTU_ACCOUNT_ID` and `FUTU_ACCOUNT_PWD_MD5`
   (32 hex chars; computed in SKILL.md step 4). Leave `FUTU_OPEND_VER` at
   the value the template ships — it mirrors `opend_version.json`.

2. **Place `futu.pem` at `./futu.pem`** with mode `0644`. The compose file
   bind-mounts `$LOCAL_RSA_FILE_PATH` (default `./futu.pem`) into
   `/.futu/futu.pem` (see `docker-compose.yaml:41`).

3. **Bring it up.**

   ```bash
   docker compose up -d
   ```

   `network_mode: host` is set in `docker-compose.yaml:21` — do **not** add
   a `ports:` block; under host networking it is ignored with a warning.

4. **Tail logs and watch for the 2FA prompt** (SKILL.md step 6).

   ```bash
   docker compose logs -f futu-opend
   ```

5. **Deliver SMS / CAPTCHA** via `references/two-factor.md`.

6. **Verify** (SKILL.md step 8). Use `pgrep`, **never** the broken TCP
   healthcheck.

## Persistent login session

The named volume `futu-opend-data` (declared at `docker-compose.yaml:53-54`)
caches the device-whitelist token and CAPTCHA PNG. SMS is only required
when this volume is empty.

- `docker compose down` — keeps the volume; next `up` skips SMS.
- `docker compose down -v` — wipes the volume; next `up` requires SMS.

**Pre-PR-65 caveat**: images built before PR #65 leave the mount point
root-owned. If you adopted the volume against an older image and now hit
EACCES on first write, `docker compose down -v` is the fix (cost: a fresh
SMS on next start). Plain `docker compose pull` does not help — this
compose file builds locally (no `image:` directive).

## What not to do

- `docker compose config` leaks `FUTU_ACCOUNT_PWD` to stdout. Don't run it.
- `docker exec futu-opend env` leaks the same values. Don't run it.
- Don't change `network_mode: host` to bridge — login fails ~45 s in
  with `>>>登录失败,网络异常`.
- Don't assert `Health: healthy` — the compose-shipped TCP healthcheck is
  broken (loopback vs. hostname bind).
