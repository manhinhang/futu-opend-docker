# CLAUDE.md - AI Assistant Guide for Futu OpenD Docker

## Project Overview

**Futu OpenD Docker** is a lightweight Docker containerization project for Futu OpenD, an API gateway for Futu Securities trading platform. This project packages the Futu OpenD application into Docker containers with support for multiple base images (Ubuntu and CentOS) and automatic version management.

**Key Facts:**
- **License:** MIT
- **Author:** manhinhang
- **Container Registry:** GitHub Container Registry (ghcr.io)
- **Primary Language:** Shell scripts, with Node.js for automation
- **Current Stable Version:** 9.4.5418 (as of opend_version.json)

## Repository Structure

```
futu-opend-docker/
├── .github/
│   └── workflows/           # GitHub Actions CI/CD pipelines
│       ├── publish.yml      # Main Docker image build & publish workflow
│       ├── check-ver-upadte.yml  # Automated version checking (daily cron)
│       ├── pr-agent.yml     # PR automation
│       └── lint.yaml        # Linting workflow
├── script/
│   ├── start.sh             # Container entrypoint script
│   ├── download_futu_opend.sh  # Downloads Futu OpenD binaries
│   └── check_version.js     # Scrapes version info from Futu website
├── Dockerfile               # Multi-stage build for Ubuntu & CentOS
├── docker-compose.yaml      # Local development/testing setup
├── FutuOpenD.xml           # Configuration template with placeholders
├── opend_version.json      # Version tracking (beta & stable)
├── package.json            # Node.js dependencies (jsdom for scraping)
├── matrix                  # Build matrix configuration (legacy)
├── .env                    # Environment variables template
└── README.md               # User documentation
```

## Key Files Explained

### Dockerfile (Multi-stage Build)

The Dockerfile uses a sophisticated multi-stage build pattern:

1. **Base Stages:** `base-ubuntu` (Ubuntu 16.04) and `base-centos` (CentOS 7)
2. **Build Stages:** Downloads and extracts Futu OpenD binaries
3. **Final Stages:** Creates minimal runtime images with security hardening

**Key Features:**
- Build argument `BASE_IMG` controls Ubuntu vs CentOS
- Build argument `FUTU_OPEND_VER` specifies Futu OpenD version
- Non-root user `futu` for security (UID/GID created at build time)
- Healthcheck monitors FutuOpenD process with `pgrep`
- Default command: `/bin/start.sh`

**Targets:**
- `final-ubuntu-target` → Ubuntu-based image
- `final-centos-target` → CentOS-based image
- `final` → Default (Ubuntu)

### FutuOpenD.xml Configuration

This XML template contains placeholders replaced at runtime by `start.sh`:

**Placeholders:**
- `###FUTU_ACCOUNT_ID###` → User's Futu account ID
- `###FUTU_ACCOUNT_PWD_MD5###` → MD5 hash of password
- `###FUTU_OPEND_RSA_FILE_PATH###` → Path to RSA private key

**Key Settings:**
- `<ip>` and `<api_port>` - Network binding
- `<rsa_private_key>` - Encryption key path
- `<auto_hold_quote_right>` - Automatically grab quote permissions
- `<pdt_protection>` and `<dtcall_confirmation>` - US trading protections

### script/start.sh

Container entrypoint that:
1. Computes MD5 hash of `FUTU_ACCOUNT_PWD`
2. Uses `sed` to replace XML placeholders with environment variables
3. Launches `/bin/FutuOpenD` binary

**Important:** The script uses `sed -i` for in-place XML modification.

### script/check_version.js

Automated version checker using `jsdom`:
- Scrapes https://www.futunn.com/en/download/OpenAPI
- Extracts beta and stable versions from DOM
- Writes `opend_version.json` with structured data
- Used by GitHub Actions workflow for automated updates

### opend_version.json

Version manifest:
```json
{
  "betaVersion": null,
  "stableVersion": "9.4.5418"
}
```

## Environment Variables

**Required:**
- `FUTU_ACCOUNT_ID` - Futu account identifier
- `FUTU_ACCOUNT_PWD` - Account password (plain text, hashed at runtime)

**Optional:**
- `FUTU_OPEND_RSA_FILE_PATH` - RSA key path in container (default: `/.futu/futu.pem`)
- `FUTU_OPEND_IP` - Listening IP (default: container hostname)
- `FUTU_OPEND_PORT` - API port (default: `11111`)
- `FUTU_OPEND_TELNET_PORT` - Telnet port (default: `22222`)

**Local Development (.env file):**
- `LOCAL_RSA_FILE_PATH` - Host path for RSA key mapping

## Build System

### Local Builds

**Ubuntu:**
```bash
docker build -t futu-opend-docker \
  --build-arg FUTU_OPEND_VER=9.4.5418 \
  --build-arg BASE_IMG=ubuntu \
  --target final-ubuntu-target .
```

**CentOS:**
```bash
docker build -t futu-opend-docker \
  --build-arg FUTU_OPEND_VER=9.4.5418 \
  --build-arg BASE_IMG=centos \
  --target final-centos-target .
```

### Docker Compose

For local development:
```bash
# 1. Edit .env with credentials
# 2. Generate RSA key: openssl genrsa -out futu.pem 1024
# 3. Start container
docker compose up -d

# 4. Attach for 2FA
docker attach futu-opend
input_phone_verify_code -code=<YOUR_CODE>
```

## CI/CD Workflows

### publish.yml - Automated Publishing

**Triggers:** Push to any branch (except README/LICENSE changes)

**Process:**
1. **extract-version job:**
   - Reads `opend_version.json`
   - Creates build matrix: `[ubuntu, centos] × [stable, beta]`
   - Outputs: `matrix`, `beta_version`, `stable_version`

2. **build job (matrix):**
   - Builds all combinations in parallel
   - Tags images:
     - `{base}-{version}` (e.g., `ubuntu-9.4.5418`)
     - `{base}-stable` or `{base}-beta`
   - Pushes only on `main` branch

**Image Tags:**
- `ghcr.io/manhinhang/futu-opend-docker:ubuntu-stable`
- `ghcr.io/manhinhang/futu-opend-docker:ubuntu-9.4.5418`
- `ghcr.io/manhinhang/futu-opend-docker:centos-stable`
- `ghcr.io/manhinhang/futu-opend-docker:centos-9.4.5418`

### check-ver-upadte.yml - Version Monitoring

**Triggers:**
- Daily cron: `0 0 * * *` (midnight UTC)
- Manual: `workflow_dispatch`

**Process:**
1. Runs `check_version.js` to scrape latest versions
2. If `opend_version.json` changed:
   - Closes existing PRs titled "Update Futu OpenD version"
   - Creates branch `update-futu-opend-version`
   - Commits changes
   - Opens new PR

**Bot Identity:** `github-actions[bot]`

## Development Conventions

### Branch Strategy

**Main Branch:** `main` (stable releases)

**Feature Branches:**
- Pattern: `claude/claude-md-{session-id}-{unique-id}`
- Example: `claude/claude-md-mhz60hq2t9q8m08z-014BW3FLBHuqxyCc8my4sUXH`
- Used for AI assistant development sessions

**Automated Branches:**
- `update-futu-opend-version` (created by version checker)

### Commit Message Conventions

Based on recent history:
- "Update Futu OpenD version" - Version bumps
- "Merge pull request #N from ..." - PR merges
- Descriptive, imperative mood

### Git Operations

**Important:** Branch names for pushes must:
- Start with `claude/`
- End with matching session ID
- Otherwise, push fails with 403 error

**Push with retry logic:**
```bash
git push -u origin <branch-name>
# Retry up to 4 times with exponential backoff (2s, 4s, 8s, 16s)
```

## Security Considerations

1. **Non-root User:** Containers run as `futu` user (not root)
2. **RSA Encryption:** API communication encrypted with RSA private key
3. **Password Hashing:** Passwords MD5-hashed in XML (though MD5 is weak)
4. **Volume Mounts:** Secrets (`.pem`, `.env`) mounted as volumes, not baked into image
5. **Dockerignore:** Prevents `.git`, `node_modules`, `.env` from leaking into image

**Security Notes:**
- MD5 is cryptographically weak; consider SHA-256 if protocol allows
- RSA key should be 2048-bit minimum (current example uses 1024-bit)
- `.env` file should never be committed (gitignored)

## Common Tasks for AI Assistants

### Updating Futu OpenD Version

1. Modify `opend_version.json`:
   ```json
   {
     "betaVersion": "9.5.5500",
     "stableVersion": "9.4.5418"
   }
   ```

2. Update default version in `Dockerfile` (line 9, 20):
   ```dockerfile
   ARG FUTU_OPEND_VER=9.5.5500
   ```

3. Update `docker-compose.yaml` if needed:
   ```yaml
   build:
     args:
       FUTU_OPEND_VER: 9.5.5500
   ```

4. Commit with message: "Update Futu OpenD version"

### Adding New Configuration Options

1. Add placeholder to `FutuOpenD.xml`:
   ```xml
   <new_option>###NEW_OPTION###</new_option>
   ```

2. Add environment variable to `Dockerfile`:
   ```dockerfile
   ENV NEW_OPTION=default_value
   ```

3. Add sed replacement to `script/start.sh`:
   ```bash
   sed -i "s|<new_option>.*</new_option>|<new_option>$NEW_OPTION</new_option>|" $FUTU_OPEND_XML_PATH
   ```

4. Document in README.md

### Debugging Container Issues

**View logs:**
```bash
docker logs futu-opend
```

**Attach to container:**
```bash
docker attach futu-opend
# Detach: Ctrl+P, Ctrl+Q (don't stop container)
```

**Check healthcheck:**
```bash
docker inspect futu-opend | grep -A 10 Health
```

**Exec into container:**
```bash
docker exec -it futu-opend /bin/bash
```

### Testing Local Changes

1. Build locally:
   ```bash
   docker build -t test-futu-opend \
     --build-arg FUTU_OPEND_VER=9.4.5418 \
     --build-arg BASE_IMG=ubuntu .
   ```

2. Run with test config:
   ```bash
   docker run -it --rm \
     -v $(pwd)/FutuOpenD.xml:/bin/FutuOpenD.xml \
     -v $(pwd)/futu.pem:/.futu/futu.pem \
     -e FUTU_ACCOUNT_ID=test \
     -e FUTU_ACCOUNT_PWD=test123 \
     -p 11111:11111 \
     test-futu-opend
   ```

## Architecture Notes

### Multi-stage Build Rationale

The Dockerfile uses multi-stage builds to:
1. **Separation of Concerns:** Build stage downloads binaries, final stage runs them
2. **Size Optimization:** Build tools (curl, tar) not included in final image
3. **Multi-platform Support:** Single Dockerfile handles Ubuntu and CentOS
4. **Build Argument Selection:** `BASE_IMG` chooses final image at build time

### Why Two Base Images?

- **Ubuntu 16.04:** Stable, well-tested, smaller size
- **CentOS 7:** Required for specific deployment environments (e.g., enterprise RHEL)

### Version Management Strategy

- **Automated Checking:** Daily scraping ensures versions stay current
- **Manual Control:** Humans review version update PRs before merging
- **Matrix Builds:** All combinations built automatically on merge

## Dependencies

### Runtime
- None (Futu OpenD is statically linked binary)

### Build/Development
- **Node.js 20:** For `check_version.js` script
- **jsdom 24.1.3:** HTML parsing for version scraping
- **curl:** Downloading Futu OpenD binaries (build-time only)

### System Requirements
- Docker Engine 20.10+
- Docker Compose 2.0+ (optional, for compose workflow)

## Troubleshooting

### Common Issues

**"Failed to download Futu OpenD binary"**
- Check network connectivity to `softwaredownload.futunn.com`
- Verify version number exists on Futu's download page
- Review `script/download_futu_opend.sh` curl headers

**"Permission denied" when starting container**
- Ensure RSA key has correct permissions: `chmod 600 futu.pem`
- Check volume mount paths in docker-compose.yaml

**"Invalid login credentials"**
- Verify `FUTU_ACCOUNT_ID` and `FUTU_ACCOUNT_PWD` in `.env`
- Check if 2FA code was entered (use `docker attach`)

**Container exits immediately**
- Check logs: `docker logs futu-opend`
- Verify FutuOpenD.xml syntax (must be valid XML)
- Ensure all required placeholders are replaced by start.sh

## References

- **Futu OpenAPI Docs:** https://openapi.futunn.com/futu-api-doc/
- **FutuOpenD Command Reference:** https://openapi.futunn.com/futu-api-doc/opend/opend-cmd.html
- **GitHub Container Registry:** https://github.com/manhinhang/futu-opend-docker/packages

## Recent Changes (as of latest commit)

- **Commit 33954d4:** Merged PR #34 - Updated Futu OpenD version
- **Commit 7475abd:** Updated Futu OpenD version
- **Commit 79acfa1:** Created home directory for non-root user 'futu'
- **Current Version:** 9.4.5418 (stable)

## AI Assistant Best Practices

1. **Always check `opend_version.json`** before suggesting version-related changes
2. **Test build locally** before pushing Dockerfile changes
3. **Update all version references** consistently (Dockerfile, docker-compose, README)
4. **Preserve XML formatting** in FutuOpenD.xml (indentation matters)
5. **Use descriptive commit messages** following existing patterns
6. **Create PRs from feature branches** (never commit directly to main)
7. **Review GitHub Actions logs** after pushing to verify build success
8. **Respect security practices** (never commit secrets, use volume mounts)

---

**Last Updated:** 2025-11-14
**Document Version:** 1.0
**For:** Claude Code AI Assistant
