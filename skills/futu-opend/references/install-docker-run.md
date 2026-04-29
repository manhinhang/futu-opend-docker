# Install — plain `docker run`

Use when the user does not want compose. Mirrors
[`README.md`](../../../README.md) "Create a container from the image and
run it".

## Steps

1. **Generate `futu.pem`** (SKILL.md step 3). Mode must be `0644`.

2. **Compute the password MD5** (SKILL.md step 4). Persist only the hash
   in your shell — never echo the plaintext.

3. **Pick the image tag.** Defaults to `:ubuntu-stable`. Other options:

   | Tag                              | Use case                          |
   |----------------------------------|-----------------------------------|
   | `ubuntu-stable`                  | Default; tracks current stable    |
   | `centos-stable`                  | CentOS 7 runtime                  |
   | `ubuntu-{version}` (e.g. `ubuntu-10.4.6408`) | Pinned version, ubuntu base |
   | `centos-{version}`               | Pinned version, centos base       |
   | `ubuntu-beta` / `centos-beta`    | Beta channel (when published)     |

   Source of truth for the current stable version: `opend_version.json`.

4. **Run the container** (host networking is mandatory):

   ```bash
   docker run -d --name futu-opend \
     --network host \
     -e FUTU_ACCOUNT_ID="$FUTU_ACCOUNT_ID" \
     -e FUTU_ACCOUNT_PWD_MD5="$FUTU_ACCOUNT_PWD_MD5" \
     -e FUTU_OPEND_IP=0.0.0.0 \
     -v "$(pwd)/futu.pem:/.futu/futu.pem" \
     -v futu-opend-data:/home/futu/.com.futunn.FutuOpenD \
     ghcr.io/manhinhang/futu-opend-docker:ubuntu-stable
   ```

   The volume mount on `/home/futu/.com.futunn.FutuOpenD` persists the
   login session across `docker rm -f && docker run` cycles.

   The README example uses `-p 11111:11111 -p 22222:22222` instead of
   `--network host`. Bridge networking has been observed to silently fail
   login (`>>>登录失败,网络异常` ~45 s after a successful credential
   check) — `--network host` is the supported configuration.

5. **Tail logs and watch for the 2FA prompt** (SKILL.md step 6):

   ```bash
   docker logs -f futu-opend
   ```

6. **Deliver SMS / CAPTCHA** via `references/two-factor.md`.

7. **Verify** (SKILL.md step 8) with `pgrep` inside the container.

## Persistent login session

`-v futu-opend-data:/home/futu/.com.futunn.FutuOpenD` keeps the
device-whitelist token. To wipe it (forces a fresh SMS):

```bash
docker rm -f futu-opend
docker volume rm futu-opend-data
```

## What not to do

- Don't omit `--network host`. Bridge net silently breaks login.
- Don't set `futu.pem` to `0600` — `>>>API启用RSA: 否` and login is rejected.
- Don't pass `-e FUTU_ACCOUNT_PWD=<plaintext>` unless you have to — it's a
  deprecated legacy fallback. Use `FUTU_ACCOUNT_PWD_MD5` instead.
