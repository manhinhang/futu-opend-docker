# Futu OpenD Docker

[![Docker Pulls](https://img.shields.io/github/package-json/v/manhinhang/futu-opend-docker)](https://github.com/manhinhang/futu-opend-docker/packages)
[![GitHub](https://img.shields.io/github/license/manhinhang/futu-opend-docker)](https://github.com/manhinhang/futu-opend-docker/blob/main/LICENSE)

lightweight futu opend docker

> **Running on Kubernetes?** See [`k8s/README.md`](k8s/README.md) for a
> reference deployment plus first-run SMS/CAPTCHA delivery via `kubectl`.

## Pull the docker image from GitHub Container Registry

```bash
# default base image is ubuntu
docker pull ghcr.io/manhinhang/futu-opend-docker:ubuntu-stable
```

## container tags pattern

| Base Image | Tags                   |
| ---------- | ---------------------- |
| ubuntu     | ubuntu-stable          |
| ubuntu     | ubuntu-beta            |
| ubuntu     | ubuntu-{opend_version} |
| centos     | centos-stable          |
| centos     | centos-beta            |
| centos     | centos-{opend_version} |

## Create a container from the image and run it

> Generate your own RSA key
>
> ```bash
> openssl genrsa -out futu.pem 1024
> ```

```bash
# Compute the password MD5 so plaintext never lands in your shell history.
FUTU_ACCOUNT_PWD_MD5=$(echo -n '<your_password>' | md5sum | awk '{print $1}')

docker run -it --name futu-opend-docker \
-e FUTU_ACCOUNT_ID=<your_account_id> \
-e FUTU_ACCOUNT_PWD_MD5="$FUTU_ACCOUNT_PWD_MD5" \
-v $(pwd)/futu.pem:/.futu/futu.pem \
-v futu-opend-data:/home/futu/.com.futunn.FutuOpenD \
-p 11111:11111 \
-p 22222:22222 \
ghcr.io/manhinhang/futu-opend-docker
```

> `FUTU_ACCOUNT_PWD` (plaintext) is still accepted as a legacy fallback —
> the container hashes it at runtime and emits a stderr deprecation warning.
> Prefer `FUTU_ACCOUNT_PWD_MD5` to keep plaintext out of agent transcripts,
> shared shell sessions, and `docker compose config` output.
>
> The `futu-opend-data` named volume keeps FutuOpenD's login session across
> container recreates so SMS verification isn't required on every restart.
> See [Login session persistence](#login-session-persistence) for details.
>
> **Port mappings**:
>
> - `11111`: API port for FutuOpenD protocol
> - `22222`: Telnet port for 2FA input (optional, but recommended for automation)

### Input verification codes

FutuOpenD may require two types of verification:

1. **SMS verification code** - sent to your phone
2. **Picture CAPTCHA** - downloaded to container

You can input verification codes using either `docker attach` or telnet:

#### Method 1: Using docker attach

1. Attach to futu opend container

```bash
docker attach futu-opend
```

1. Input verification code based on the type:

**For SMS verification code:**

```bash
input_phone_verify_code -code=<SMS_CODE>
```

**For picture CAPTCHA:**

First, copy the CAPTCHA image from container:

```bash
docker cp futu-opend:/home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png ./PicVerifyCode.png
```

Then view the image and input the code:

```bash
input_pic_verify_code -code=<CAPTCHA_CODE>
```

#### Method 2: Using telnet (recommended for automation)

Connect to the FutuOpenD telnet port (22222) and send the command:

**For SMS verification code:**

```bash
# Interactive
telnet localhost 22222
input_phone_verify_code -code=<SMS_CODE>

# One-liner
echo "input_phone_verify_code -code=<SMS_CODE>" | telnet localhost 22222
```

**For picture CAPTCHA:**

First, extract the CAPTCHA image:

```bash
docker cp futu-opend:/home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png ./PicVerifyCode.png
```

Then input the code via telnet:

```bash
echo "input_pic_verify_code -code=<CAPTCHA_CODE>" | telnet localhost 22222
```

**Automation script example:**

```bash
#!/bin/bash
# Auto-input SMS verification code
{
  sleep 2
  echo "input_phone_verify_code -code=$1"
  sleep 1
} | telnet localhost 22222
```

```bash
#!/bin/bash
# Auto-input picture CAPTCHA
# First extract and display the image, then input the code
docker cp futu-opend:/home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png /tmp/PicVerifyCode.png
# Display image (choose your preferred viewer)
open /tmp/PicVerifyCode.png  # macOS
# xdg-open /tmp/PicVerifyCode.png  # Linux
# start /tmp/PicVerifyCode.png  # Windows

read -p "Enter CAPTCHA code: " captcha_code
{
  sleep 2
  echo "input_pic_verify_code -code=$captcha_code"
  sleep 1
} | telnet localhost 22222
```

## Run in docker compose

Copy the tracked `.env.example` template to `.env`, then edit it (auto-loaded by `docker compose`):

```bash
cp .env.example .env
```

| Environment Variable      | Description                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FUTU_ACCOUNT_ID           | Futu account ID                                                                                                                                                  |
| FUTU_ACCOUNT_PWD_MD5      | **Preferred.** Futu account password MD5 hash. Compute with `echo -n '<pwd>' \| md5sum \| awk '{print $1}'`.                                                     |
| FUTU_ACCOUNT_PWD          | **Deprecated.** Plaintext password — hashed at runtime by `start.sh`; ignored if `FUTU_ACCOUNT_PWD_MD5` is set. Triggers a stderr deprecation warning when used. |
| FUTU_OPEND_IP             | OpenD bind address inside the container (default: `0.0.0.0`)                                                                                                     |
| FUTU_OPEND_PORT           | Futu OpenD API Port in container (default: 11111)                                                                                                                |
| FUTU_OPEND_TELNET_PORT    | Futu OpenD Telnet Port (default: 22222)                                                                                                                          |
| FUTU_OPEND_WEBSOCKET_PORT | Enable WebSocket listener on this port (default: disabled).                                                                                                      |
| FUTU_OPEND_WEBSOCKET_IP   | WebSocket bind address (default: 0.0.0.0 when FUTU_OPEND_WEBSOCKET_PORT is set, else not applied)                                                                |
| FUTU_OPEND_VER            | OpenD version to build (compose `build.args`). Defaulted in `.env.example`; mirrors `opend_version.json`.                                                        |

> **Note**: the compose file uses `network_mode: host` (and `build.network: host`) so the container shares the host's network stack. No `ports:` mapping is needed; OpenD's listeners bind directly on the host. This avoids docker-bridge connectivity issues we hit with Futu's auth servers.

```bash
docker compose up -d
```

### Login session persistence

Mounting the `futu-opend-data` named volume at
`/home/futu/.com.futunn.FutuOpenD` lets FutuOpenD's runtime state —
device-whitelist token, login cache, captcha PNG, and other session
metadata — survive container recreate. The compose stack attaches it
automatically; bare `docker run` users add
`-v futu-opend-data:/home/futu/.com.futunn.FutuOpenD`. With the volume in
place, SMS verification is **only required when the volume is empty**
(first ever run, account switch, or explicit wipe).

**Caveat — Futu-side whitelist lifetime**: Futu's server-side device
whitelist has a short shelf life (hours to days). When Futu invalidates
the whitelist, the next login will prompt for SMS again regardless of
what's in the volume. The volume eliminates _Docker-recreate-induced_
fresh-device churn; it does not extend Futu's own whitelist policy.

**Image version requirement**: this volume needs an image built from a
Dockerfile that pre-creates `/home/futu/.com.futunn.FutuOpenD` with
`futu` ownership (introduced alongside this volume). Older published
images leave the mount point owned by `root`, and FutuOpenD (running as
`futu`) will EACCES on first write. Run `docker compose pull` (or
`docker compose build`) when adopting this change.

**Wipe the volume** to force a fresh login. The volume's actual name
depends on how you launched the stack (compose namespaces it by project
directory; `docker run` does not):

```bash
# Compose users — wipes everything in one step:
docker compose down -v

# Compose users — manual, while the stack is down:
docker volume rm futu-opend-docker_futu-opend-data

# Bare `docker run` users:
docker rm -f futu-opend-docker
docker volume rm futu-opend-data
```

Run `docker volume ls` if you're not sure which volume name applies.

Wipe when:

- Switching to a different `FUTU_ACCOUNT_ID`.
- After upgrading FutuOpenD across major versions.
- Diagnosing login loops that don't respond to credential rotation.

### Healthcheck

The container includes a healthcheck that monitors the FutuOpenD process:

| Setting      | Value             | Description                        |
| ------------ | ----------------- | ---------------------------------- |
| test         | `pgrep FutuOpenD` | Check FutuOpenD process is running |
| interval     | 30s               | Check every 30 seconds             |
| timeout      | 600s              | Timeout for each check             |
| retries      | 3                 | Mark unhealthy after 3 failures    |
| start_period | 180s              | Grace period for container startup |

Check container health status:

```bash
docker ps --format "table {{.Names}}\t{{.Status}}"
```

Then enter verification codes when prompted:

**Using docker attach:**

```bash
docker attach futu-opend

# For SMS verification
input_phone_verify_code -code=<SMS_CODE>

# For picture CAPTCHA (extract image first)
docker cp futu-opend:/home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png ./PicVerifyCode.png
input_pic_verify_code -code=<CAPTCHA_CODE>
```

**Using telnet** (see [Input verification codes](#input-verification-codes) section for full details):

```bash
# For SMS verification
echo "input_phone_verify_code -code=<SMS_CODE>" | telnet localhost 22222

# For picture CAPTCHA
docker cp futu-opend:/home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png ./PicVerifyCode.png
echo "input_pic_verify_code -code=<CAPTCHA_CODE>" | telnet localhost 22222
```

## Build locally

> **Note**: Ubuntu builds require version 9.4.x or later with Ubuntu 18.04 base image. Ubuntu 16.04 builds are no longer provided by Futu.

- Use ubuntu as base image

```bash
docker build -t futu-opend-docker --build-arg FUTU_OPEND_VER=10.4.6408 --build-arg BASE_IMG=ubuntu .
```

- Use centos as base image

```bash
docker build -t futu-opend-docker --build-arg FUTU_OPEND_VER=10.4.6408 --build-arg BASE_IMG=centos .
```

## Troubleshooting

### Download failures

If you encounter download failures during build:

1. **Network issues**: The download script includes automatic retry logic (3 attempts)
2. **Version compatibility**: Ensure you're using a version that has Ubuntu 18.04 builds (9.4.x or later)
3. **Check available versions**: Visit [Futu OpenD download page](https://www.futunn.com/en/download/OpenAPI)

### Container startup issues

If the container fails to start:

1. **RSA key**: Ensure `futu.pem` exists and is properly mounted at `/.futu/futu.pem`
2. **Environment variables**: Verify `FUTU_ACCOUNT_ID` and either `FUTU_ACCOUNT_PWD_MD5` (preferred) or the deprecated `FUTU_ACCOUNT_PWD` are set
3. **Verification required**: First run may require verification codes
4. **Stale session state**: if you've changed accounts or upgraded OpenD across major versions, wipe the data volume — see [Login session persistence](#login-session-persistence).

### Verification codes

FutuOpenD may prompt for two types of verification:

1. **SMS verification code** (`input_phone_verify_code`)
   - Sent to your registered phone number
   - Input via docker attach or telnet

2. **Picture CAPTCHA** (`input_pic_verify_code`)
   - Downloaded to `/home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png` inside container
   - Extract with: `docker cp futu-opend:/home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png ./PicVerifyCode.png`
   - View the image and input the code

**Tip**: Use telnet method for automation - see [Input verification codes](#input-verification-codes) section for details.

## Local end-to-end test

A `node:test` suite that takes credentials from `FUTU_ACCOUNT_ID` plus `FUTU_ACCOUNT_PWD_MD5` (preferred) or the deprecated `FUTU_ACCOUNT_PWD`, drives a real login (with SMS support), and asserts the OpenAPI WebSocket layer is up. Local-only — `npm run test:e2e`.

See [docs/E2E.md](docs/E2E.md) for prerequisites, architecture, and troubleshooting.

## Disclaimer

This project is not affiliated with [Futu Securities International (Hong Kong) Limited](https://www.futuhk.com/).

Good luck and enjoy.
