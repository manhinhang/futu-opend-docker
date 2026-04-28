# Kubernetes deployment

A reference deployment of FutuOpenD for any **single-node Kubernetes cluster
with real host networking** — k3s on the host kernel, microk8s, EKS/GKE/AKS
node, bare-metal kubeadm. Vanilla manifests, no Helm, no operators, so the
mapping back to [`docker-compose.yaml`](../docker-compose.yaml) is obvious.

> **kind / k3d / docker-bridge-wrapped tools cannot serve real traffic.**
> Even with `hostNetwork: true`, a kind pod inherits the kind node's network
> namespace — and that node is itself a docker container on docker's `kind`
> bridge. CLAUDE.md flags bridge networking as the cause of
> `>>>登录失败,网络异常` ~45 s after a successful credential check. kind is
> only useful here for **local manifest validation**; see
> [Local development](#local-development) below.

## Layout

| File                  | Purpose                                                                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `namespace.yaml`      | `futu-opend` namespace                                                                                                                                                   |
| `pvc.yaml`            | 1Gi RWO claim for `/home/futu/.com.futunn.FutuOpenD` (login session)                                                                                                     |
| `deployment.yaml`     | Single-replica Deployment, `hostNetwork: true`, init container chowns the PVC, secret-mounted RSA key at mode `0644`, `pgrep FutuOpenD` liveness, TCP `:11111` readiness |
| `secret.example.yaml` | Reference template for `futu-credentials` (NOT applied via kustomize)                                                                                                    |
| `kustomization.yaml`  | Bundles namespace + PVC + Deployment for `kubectl apply -k k8s/`                                                                                                         |
| `kind-config.yaml`    | Local-dev kind cluster (used by `npm run test:k8s`)                                                                                                                      |

## Prerequisites

- A k8s cluster where pods with `hostNetwork: true` actually use the host's
  network stack (k3s on host, microk8s, EKS node, bare-metal kubeadm). Not
  kind, k3d, or anything that wraps the cluster in a docker bridge.
  **Caveat**: `hostNetwork: true` puts the pod in the node's network
  namespace — the pod can see/bind any port on the node, including
  loopback. On multi-tenant clusters that's a real blast-radius concern;
  this manifest is intended for a dedicated single-app node.
- `kubectl` access to that cluster (`kubectl config current-context` → your
  cluster).
- The image is reachable from the cluster's nodes. The published image is
  `ghcr.io/manhinhang/futu-opend-docker:ubuntu-stable` (public on GHCR);
  air-gapped clusters should mirror it to an internal registry first.
  **Production**: pin a specific version tag like
  `:ubuntu-10.4.6408` in `deployment.yaml` instead of the mutable
  `:ubuntu-stable`, so a rolling tag update doesn't silently reschedule
  the pod with new behavior.
- A default StorageClass (the PVC requests `1Gi RWO` and uses whatever the
  cluster gives it).
- Your Futu RSA key file at `./futu.pem` (mode `0644` — see
  [`../CLAUDE.md`](../CLAUDE.md) "Critical gotchas").

## Deploy

```bash
# 1. Generate (or reuse) the RSA key. Mode 0644 matters.
openssl genrsa -out futu.pem 1024
chmod 0644 futu.pem

# 2. Create the namespace and credentials Secret out-of-band so the key never
#    touches a YAML file in git. Pass the password as an MD5 hash so the
#    cluster never sees plaintext (compute with
#    `echo -n '<password>' | md5sum | awk '{print $1}'`).
kubectl create namespace futu-opend
kubectl create secret generic futu-credentials \
  --namespace futu-opend \
  --from-file=futu.pem=./futu.pem \
  --from-literal=FUTU_ACCOUNT_ID=<your-id> \
  --from-literal=FUTU_ACCOUNT_PWD_MD5=<md5-of-your-password>

# 3. Apply the manifests.
kubectl apply -k k8s/

# 4. Watch it come up.
kubectl -n futu-opend rollout status deployment/futu-opend --timeout=300s
kubectl -n futu-opend logs -f deployment/futu-opend
```

To enable WebSocket on port `33333`, uncomment the two `FUTU_OPEND_WEBSOCKET_*`
env entries in `deployment.yaml` before applying.

`FUTU_ACCOUNT_PWD` (plaintext) is still accepted as a legacy fallback —
pass `--from-literal=FUTU_ACCOUNT_PWD=<your-password>` instead of the
MD5 form above. `start.sh` hashes plaintext at runtime and emits a stderr
deprecation warning. The Secret keys are picked up via `optional: true`
`secretKeyRef`s in `deployment.yaml` regardless of which form you use.

> **Heads-up — `--from-literal` puts the value in argv.** While `kubectl
create secret …` runs, the password (or MD5) is briefly visible in
> `/proc/<pid>/cmdline` to anyone who can read it on the host you ran
> `kubectl` from. The exposure window is sub-second, but on a shared box
> prefer a 0600 env file:
>
> ```bash
> umask 077
> printf 'FUTU_ACCOUNT_PWD_MD5=%s\n' "$YOUR_PWD_MD5" > /tmp/futu-pwd.env
> kubectl create secret generic futu-credentials \
>   --namespace futu-opend \
>   --from-file=futu.pem=./futu.pem \
>   --from-literal=FUTU_ACCOUNT_ID=<your-id> \
>   --from-env-file=/tmp/futu-pwd.env
> shred -u /tmp/futu-pwd.env  # or `rm`
> ```
>
> The `npm run test:k8s` harness does this automatically.

## First-run login: deliver SMS / CAPTCHA into the pod

On the first start in a fresh PVC, FutuOpenD will prompt for a verification
code. The PVC caches the device-whitelist token, so subsequent restarts
usually skip this step (delete the PVC to force a re-prompt). The container
listens for the verification command on port `22222` (telnet protocol, CRLF
line termination). FutuOpenD asks for one of two things:

- **SMS verification code** sent to your phone → `input_phone_verify_code -code=<SMS>`
- **Picture CAPTCHA** rendered as a PNG inside the pod → `input_pic_verify_code -code=<CAPTCHA>`

Three delivery methods, all using `kubectl`. Method 1 is the recommended
default; Method 2 is best for scripts.

### Method 1: `kubectl port-forward` + telnet (recommended)

```bash
# In one shell — keep this open while delivering the code.
kubectl port-forward -n futu-opend deployment/futu-opend 22222:22222
# → "Forwarding from 127.0.0.1:22222 -> 22222"

# In another shell. CRLF matters; bare LF is silently dropped.
echo "input_phone_verify_code -code=123456" | telnet localhost 22222
# Or, if telnet isn't installed:
printf 'input_phone_verify_code -code=123456\r\n' | nc -w 2 localhost 22222
```

Tail the pod's logs (`kubectl -n futu-opend logs -f deployment/futu-opend`)
to confirm OpenD accepted the code (`>>>WebSocket监听地址` shows up after
successful login if you also enabled the WebSocket listener; otherwise the
absence of `>>>登录失败` is your signal).

### Method 2: `kubectl exec` + bash `/dev/tcp` (one-shot, no port-forward)

The image ships GNU bash, which supports `/dev/tcp/<host>/<port>` for raw TCP.
This sends the command from inside the pod itself — useful in scripts and
CI where you don't want to maintain a port-forward.

```bash
kubectl exec -n futu-opend deployment/futu-opend -- \
  bash -c 'printf "input_phone_verify_code -code=123456\r\n" > /dev/tcp/127.0.0.1/22222'
```

Same shape as `script/lib/docker.mjs::sendTelnetCommand` (CRLF, port `22222`),
just initiated from inside the container. No reply is read; check the pod
logs for the post-login signal.

### Method 3: `kubectl attach` (interactive fallback)

`docker attach` to PID 1 silently drops input on this image (the `start.sh`
shell stays in foreground but doesn't expose a usable stdin). `kubectl attach`
inherits that behavior, so this is **not recommended for automation**, but
the `tty: true` / `stdin: true` flags on the Deployment preserve the option:

```bash
kubectl attach -it -n futu-opend deployment/futu-opend
# At the prompt — drops you into FutuOpenD's interactive console:
input_phone_verify_code -code=123456
# Press Ctrl+P then Ctrl+Q to detach without killing the container.
```

If input appears to do nothing, fall back to Method 1 or 2.

### Picture CAPTCHA

When OpenD asks for a picture verification code, it writes a PNG inside the
pod. Pull it out with `kubectl cp`, view it locally, then send the code via
any of the three methods above.

```bash
# 1. Find the pod name (the deployment's current pod).
POD=$(kubectl -n futu-opend get pod -l app=futu-opend -o jsonpath='{.items[0].metadata.name}')

# 2. Copy the captcha image out.
kubectl cp futu-opend/$POD:home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png ./PicVerifyCode.png

# 3. Open ./PicVerifyCode.png in any image viewer, read the characters.

# 4. Send the code (Method 2 shown):
kubectl exec -n futu-opend deployment/futu-opend -- \
  bash -c 'printf "input_pic_verify_code -code=ABCD\r\n" > /dev/tcp/127.0.0.1/22222'
```

> Note the `kubectl cp` source path drops the leading `/`: `home/futu/...`
> rather than `/home/futu/...`. That's a long-standing kubectl quirk and is
> the format that actually works.

## Day-2 ops

```bash
# Live logs
kubectl -n futu-opend logs -f deployment/futu-opend

# Restart (PVC is RWO + strategy: Recreate, so brief downtime is expected)
kubectl -n futu-opend rollout restart deployment/futu-opend
kubectl -n futu-opend rollout status deployment/futu-opend

# Rotate credentials (replace the Secret, then restart). On shared hosts,
# pass the password via `--from-env-file=` instead of `--from-literal=` —
# see "Deploy" above for the env-file recipe.
kubectl -n futu-opend delete secret futu-credentials
kubectl create secret generic futu-credentials \
  --namespace futu-opend \
  --from-file=futu.pem=./futu.pem \
  --from-literal=FUTU_ACCOUNT_ID=<new-id> \
  --from-literal=FUTU_ACCOUNT_PWD_MD5=<md5-of-new-password>
kubectl -n futu-opend rollout restart deployment/futu-opend

# Reset the device whitelist (forces a fresh SMS on next start)
kubectl -n futu-opend scale deployment/futu-opend --replicas=0
kubectl -n futu-opend delete pvc futu-opend-data
kubectl -n futu-opend scale deployment/futu-opend --replicas=1
```

## Local development

For working on the manifests themselves without a real cluster handy.

### Manual sanity check (dummy creds, no real login)

Validates the manifests parse, the PVC binds, the init container chowns it,
the Secret resolves, and FutuOpenD launches. Login fails on dummy creds —
expected — but you'll see `>>>API启用RSA: 是` proving the Secret 0644 mode
worked.

```bash
# Spin up a local kind cluster.
kind create cluster --name futu-opend-verify --config k8s/kind-config.yaml

# Throwaway RSA key.
openssl genrsa -out /tmp/futu.pem 1024 && chmod 0644 /tmp/futu.pem

# Namespace + dummy Secret.
kubectl create namespace futu-opend
kubectl create secret generic futu-credentials \
  --namespace futu-opend \
  --from-file=futu.pem=/tmp/futu.pem \
  --from-literal=FUTU_ACCOUNT_ID=dummy \
  --from-literal=FUTU_ACCOUNT_PWD_MD5=dummy

# Server-side dry-run, then real apply.
kubectl apply -k k8s/ --dry-run=server
kubectl apply -k k8s/
kubectl -n futu-opend rollout status deployment/futu-opend --timeout=300s
kubectl -n futu-opend logs deployment/futu-opend --tail=50

# Cleanup.
kind delete cluster --name futu-opend-verify
```

Pass criteria: dry-run reports no validation errors, `>>>API启用RSA: 是`
appears in the logs, the pod reaches `Running` at least once.

### `npm run test:k8s` — automated harness

A `node:test` harness at `script/e2e.k8s.test.mjs` with two backends.

| Backend          | Asserts                                                                                                                                                                                                                                                      | Use when                                                                    |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `kind` (default) | Pod reached Running, init container exited 0, logs contain `>>>API启用RSA: 是` + `>>>API监听地址` + `>>>Telnet监听地址`. **Durable signals only** — no live TCP / port-forward / SMS, because the bridge-net post-login crashloop on kind makes those flaky. | Manifest validation in CI/local without a real cluster.                     |
| `existing`       | All of the above plus live: `pgrep FutuOpenD`, TCP probe through port-forward, WS handshake HTTP-101, no `登录失败` markers, pod still Running.                                                                                                              | You have a real-host-network cluster set as your current `kubectl` context. |

The docker-compose harness (`npm run test:e2e`) remains the canonical
"FutuOpenD really logs into Futu" test; the k8s harness is the
manifest-equivalence test.

#### Harness prerequisites

```bash
# Common to both backends
openssl genrsa -out futu.pem 1024 && chmod 0644 futu.pem
export FUTU_ACCOUNT_ID=$(op read "op://<vault>/<item>/username")
# Preferred: MD5 hash so plaintext never enters the shell or the cluster.
export FUTU_ACCOUNT_PWD_MD5=$(op read "op://<vault>/<item>/password" | tr -d '\n' | md5sum | awk '{print $1}')
# Legacy fallback (deprecated; the harness still accepts it):
# export FUTU_ACCOUNT_PWD=$(op read "op://<vault>/<item>/password")
# (or pre-populate .env.e2e)

# kind backend only
go install sigs.k8s.io/kind@latest          # binary lands at ~/go/bin/kind
export KIND_BIN=$HOME/go/bin/kind            # if not on PATH
docker pull ghcr.io/manhinhang/futu-opend-docker:ubuntu-stable
#   OR build locally — see "Locally built image" below.

# existing backend only
kubectl config use-context <real-cluster-context>
# Cluster must be able to access the image (registry-pullable or pre-loaded).
```

#### Run

```bash
# Default: kind backend (manifest validation)
npm run test:k8s

# Full e2e against your current kubectl context
K8S_E2E_BACKEND=existing npm run test:k8s
```

#### Locally built image

```bash
docker build -t futu-opend-docker:dev \
  --build-arg FUTU_OPEND_VER=$(jq -r .stableVersion opend_version.json) \
  --target final-ubuntu-target .
K8S_E2E_IMAGE=futu-opend-docker:dev npm run test:k8s
```

## Caveats

- **Real host networking is required.** kind, k3d, and any other tool that
  wraps the cluster in a docker bridge cannot serve Futu traffic — login
  fails post-cred-check with `>>>登录失败,网络异常`. See the intro and
  [`../CLAUDE.md`](../CLAUDE.md) "Critical gotchas".
- **Single replica is structural, not a knob.** The PVC is RWO and FutuOpenD's
  login session is single-writer state. `strategy: Recreate` is set
  deliberately — switching to `RollingUpdate` will deadlock on the volume.
- **PVC ownership.** The init container `chown`s the mount point because
  fresh RWO PVCs come up root-owned and the futu user (created via
  `useradd -r` in the Dockerfile) has an auto-assigned system UID we don't
  want to hardcode in `fsGroup`.
- **RSA key mode `0644`.** The secret volume sets `defaultMode: 0644`. Lower
  modes silently disable RSA inside the container (the futu UID can't read
  a root-owned `0600` file) and Futu rejects the login.
- **`docker attach`-style input is unreliable** on this image. Telnet to
  `22222` (Method 1 or 2 above) is the supported automation entrypoint.
- **Pod Security Standards: Baseline-compatible, not Restricted.** The main
  container ships `allowPrivilegeEscalation: false`, `capabilities.drop:
[ALL]`, and `seccompProfile: RuntimeDefault`. We **don't** set
  `runAsNonRoot: true` because the Dockerfile uses `USER futu` (a name);
  kubelet refuses such a container with `image has non-numeric user (futu),
cannot verify user is non-root`. To run on a PSS Restricted cluster, probe
  the image's futu UID and pin it explicitly:

  ```bash
  docker run --rm --entrypoint id ghcr.io/manhinhang/futu-opend-docker:ubuntu-stable -u
  # → e.g. 999
  ```

  Then add to the main container's `securityContext`:

  ```yaml
  runAsUser: 999 # whatever the probe printed
  runAsNonRoot: true
  ```

## See also

- [`../CLAUDE.md`](../CLAUDE.md) — "Critical gotchas" section behind every
  decision in `deployment.yaml`.
- [`../docker-compose.yaml`](../docker-compose.yaml) — the source-of-truth
  orchestration manifest these files mirror.
- [`../README.md`](../README.md) — docker-compose deployment + the same
  SMS/CAPTCHA recipes via `docker exec` instead of `kubectl`.
- [`../docs/E2E.md`](../docs/E2E.md) — e2e harness, prerequisites, 2FA flow.
