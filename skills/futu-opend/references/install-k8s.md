# Install — Kubernetes

Use when the user wants k8s. Mirrors
[`k8s/README.md`](../../../k8s/README.md) "Deploy".

## Cluster requirement

Pods with `hostNetwork: true` must actually use the host's network stack
(k3s on host, microk8s, EKS/GKE/AKS node, bare-metal kubeadm). **kind and
k3d cannot serve real Futu traffic** — even with `hostNetwork: true`,
their pods inherit the kind/k3d node's network namespace, which is itself
a docker container on docker's `kind` bridge. Bridge networking causes
`>>>登录失败,网络异常` ~45 s after login.

kind is fine for **manifest validation** only — see
`k8s/README.md` "Local development".

## Steps

1. **Generate `futu.pem`** (SKILL.md step 3). Mode must be `0644`. The
   Secret volume in `deployment.yaml` sets `defaultMode: 0644` — lower
   modes silently break RSA inside the container.

2. **Compute the password MD5** (SKILL.md step 4).

3. **Create the namespace and credentials Secret out-of-band.** This
   keeps the RSA key out of YAML and version control. `secret.example.yaml`
   is a reference template — do **not** apply it via kustomize (it isn't
   referenced in `kustomization.yaml`).

   ```bash
   kubectl create namespace futu-opend
   kubectl create secret generic futu-credentials \
     --namespace futu-opend \
     --from-file=futu.pem=./futu.pem \
     --from-literal=FUTU_ACCOUNT_ID="$FUTU_ACCOUNT_ID" \
     --from-literal=FUTU_ACCOUNT_PWD_MD5="$FUTU_ACCOUNT_PWD_MD5"
   ```

   On a shared host, prefer the `--from-env-file=` form so the value isn't
   visible in `/proc/<pid>/cmdline` (sub-second exposure window):

   ```bash
   umask 077
   printf 'FUTU_ACCOUNT_PWD_MD5=%s\n' "$FUTU_ACCOUNT_PWD_MD5" > /tmp/futu-pwd.env
   kubectl create secret generic futu-credentials \
     --namespace futu-opend \
     --from-file=futu.pem=./futu.pem \
     --from-literal=FUTU_ACCOUNT_ID="$FUTU_ACCOUNT_ID" \
     --from-env-file=/tmp/futu-pwd.env
   shred -u /tmp/futu-pwd.env
   ```

4. **Apply the manifests via kustomize.**

   ```bash
   kubectl apply -k k8s/
   kubectl -n futu-opend rollout status deployment/futu-opend --timeout=300s
   ```

   `kustomization.yaml` bundles `namespace.yaml` + `pvc.yaml` +
   `deployment.yaml`. The init container in `deployment.yaml` chowns the
   PVC to the futu UID; without it FutuOpenD EACCESes on first write.

5. **Tail logs and watch for the 2FA prompt** (SKILL.md step 6):

   ```bash
   kubectl -n futu-opend logs -f deployment/futu-opend
   ```

6. **Deliver SMS / CAPTCHA** via `references/two-factor.md` (k8s section).

7. **Verify** (SKILL.md step 8) — `kubectl exec` + `pgrep`.

## Production pinning

`deployment.yaml` references `:ubuntu-stable` by default. For production,
swap to a pinned tag like `:ubuntu-10.4.6408` so a rolling tag update
doesn't silently reschedule the pod with new behavior. Source of truth:
`opend_version.json`.

## WebSocket

To expose WebSocket on port `33333`, uncomment the two
`FUTU_OPEND_WEBSOCKET_*` env entries in `deployment.yaml` before applying.

## What not to do

- Don't apply `secret.example.yaml` via kustomize — it's a reference
  template, not a real secret.
- Don't deploy on kind / k3d expecting it to log in successfully.
- Don't set `strategy: RollingUpdate` — the PVC is RWO and will deadlock.
  Single-replica `Recreate` is structural.
- Don't drop the init container — fresh RWO PVCs come up root-owned.
