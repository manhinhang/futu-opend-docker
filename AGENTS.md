# PROJECT KNOWLEDGE BASE

**Generated:** 2026-03-05T15:00:40Z
**Commit:** 1895191
**Branch:** main

## OVERVIEW

Docker containerization for Futu OpenD — a trading API gateway for Futu Securities. Multi-arch builds (Ubuntu/CentOS) with automated version tracking and CI/CD to GHCR.

## STRUCTURE

```
.
├── Dockerfile              # Multi-stage build (ubuntu/centos targets)
├── docker-compose.yaml     # Local dev compose
├── FutuOpenD.xml           # Config template (sed-replaced at runtime)
├── opend_version.json      # Version tracking (auto-updated by CI)
├── script/
│   ├── start.sh            # Entrypoint — replaces XML placeholders
│   ├── download_futu_opend.sh  # Downloads FutuOpenD tarball
│   ├── check_version.js    # Version scraper with retry, timeout, validation
│   └── check_version.test.js  # Unit tests (node:test)
└── .github/workflows/      # CI: publish, lint, version-check, pr-agent
```

## WHERE TO LOOK

| Task                   | Location                        | Notes                                      |
| ---------------------- | ------------------------------- | ------------------------------------------ |
| Add build arg          | `Dockerfile` L9, L20, L31, L38  | `FUTU_OPEND_VER`                           |
| Modify startup         | `script/start.sh`               | XML sed replacement happens here           |
| Change CI triggers     | `.github/workflows/publish.yml` | Matrix: BASE_IMG × VERSION                 |
| Update config template | `FutuOpenD.xml`                 | Placeholders: `###VAR###`                  |
| Version detection      | `script/check_version.js`       | Scraper with retry, timeout, validation    |
| Run tests              | `script/check_version.test.js`  | `node --test script/check_version.test.js` |

## CONVENTIONS

- **Multi-stage Docker**: `final-ubuntu-target` / `final-centos-target` targets selected via `BASE_IMG` arg
- **Non-root user**: All images run as `futu` user (created at build)
- **Env var injection**: `FUTU_ACCOUNT_ID`, `FUTU_ACCOUNT_PWD`, `FUTU_OPEND_RSA_FILE_PATH`, `FUTU_OPEND_IP`, `FUTU_OPEND_PORT`
- **Password hashing**: MD5 of password injected at runtime (L5 of start.sh)
- **Version tracking**: `opend_version.json` updated by scheduled CI, triggers PR on change

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER** run containers as root — `USER futu` enforced
- **NEVER** hardcode credentials — use env vars or `.env` file
- **NEVER** modify `FutuOpenD.xml` directly — it's a template, changes overwritten at runtime
- **NEVER** skip RSA key — required for API encryption

## UNIQUE STYLES

- **XML templating**: `sed -i` replaces `###PLACEHOLDER###` patterns in `FutuOpenD.xml` at container start
- **Dual base images**: Ubuntu 16.04 and CentOS 7 supported via multi-stage Dockerfile
- **Healthcheck**: `pgrep FutuOpenD` with 180s start period (slow startup expected)
- **2FA flow**: User must `docker attach` and run `input_phone_verify_code -code=XXX`

## COMMANDS

```bash
# Build locally (Ubuntu)
docker build -t futu-opend-docker --build-arg FUTU_OPEND_VER=9.3.5308 --build-arg BASE_IMG=ubuntu .

# Build locally (CentOS)
docker build -t futu-opend-docker --build-arg FUTU_OPEND_VER=9.3.5308 --build-arg BASE_IMG=centos .

# Run with compose (requires .env)
docker compose up -d

# Attach for 2FA
docker attach futu-opend
input_phone_verify_code -code=XXXXXX

# Check for new versions
node script/check_version.js
```

## NOTES

- **RSA key required**: Generate with `openssl genrsa -out futu.pem 1024`, mount to container
- **Slow startup**: FutuOpenD takes 2-3 minutes to initialize; healthcheck has 180s grace period
- **2FA required**: First run needs SMS code input via attached terminal
- **Tests**: `node --test script/check_version.test.js` (uses built-in node:test)
- **Disclaimer**: Not affiliated with Futu Securities
