# Troubleshooting — symptom → root cause → fix

Match the observed symptom **before** changing anything. Pulled from
[`CLAUDE.md`](../../../CLAUDE.md) "Critical gotchas" so the skill stays in
sync with project memory.

| Symptom                                                                                                                               | Root cause                                                                                                                                                                                               | Fix                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `>>>登录失败,网络异常` ~45 s after a successful credential check                                                                      | Bridge networking. FutuOpenD's outbound to Futu's auth servers fails on the docker bridge.                                                                                                               | Use `--network host` (docker run) / `network_mode: host` (compose) / `hostNetwork: true` on a real-host-network cluster (k8s). Never use kind/k3d for production.                                                                           |
| `>>>API启用RSA: 否` in logs                                                                                                           | `futu.pem` is mode `0600`. The in-container `futu` UID can't read root-owned `0600` files — RSA is silently disabled, Futu rejects login.                                                                | `chmod 0644 futu.pem`. The k8s Secret volume already sets `defaultMode: 0644`; if you see this on k8s, double-check the Secret was created `--from-file=futu.pem=./futu.pem`.                                                               |
| EACCES on `/home/futu/.com.futunn.FutuOpenD`                                                                                          | Pre-PR-65 image left the volume mount point root-owned. The `futu` UID can't write to it.                                                                                                                | `docker compose down -v` (compose) / `docker volume rm futu-opend-data` (docker run) / `kubectl delete pvc futu-opend-data` (k8s). **Costs a fresh SMS** on next start. `docker compose pull` does **not** help — this repo builds locally. |
| Healthcheck stuck in `starting` forever                                                                                               | Compose-shipped TCP probe targets `127.0.0.1:11111` but OpenD binds the hostname-resolved interface (set by `FUTU_OPEND_IP=0.0.0.0`). The Dockerfile-shipped healthcheck is `pgrep FutuOpenD` and works. | Don't assert `Health.Status == "healthy"`. Assert `pgrep FutuOpenD` instead. The compose healthcheck is a known false negative.                                                                                                             |
| Ambiguous "network anomaly" message after rapid login retries (looks identical to the bridge-net failure)                             | Futu's server is rate-limiting your account.                                                                                                                                                             | Wait **30+ minutes** before the next attempt. Don't keep retrying — you'll extend the cool-down.                                                                                                                                            |
| `WARNING: FUTU_ACCOUNT_PWD is deprecated…` on stderr                                                                                  | Only the plaintext password is set; `start.sh` is hashing it at runtime.                                                                                                                                 | Set `FUTU_ACCOUNT_PWD_MD5` instead and unset `FUTU_ACCOUNT_PWD`. Compute the hash with `echo -n '<pwd>' \| md5sum \| awk '{print $1}'`.                                                                                                     |
| Plaintext password leaked in a transcript / log                                                                                       | User ran `docker compose config` or `docker exec <container> env`. Both surface every env var, including `FUTU_ACCOUNT_PWD` (and the `FUTU_ACCOUNT_PWD_MD5` hash).                                       | Rotate the Futu password immediately. Don't run those commands again — they leak by design.                                                                                                                                                 |
| 2FA delivered via telnet but FutuOpenD prompts again                                                                                  | Bare LF instead of CRLF. The telnet protocol expects `\r\n`; bare LF is silently dropped.                                                                                                                | Re-send with CRLF: `printf 'input_phone_verify_code -code=<CODE>\r\n' \| nc -w 2 localhost 22222`.                                                                                                                                          |
| `docker attach` hangs with no echo and the code never reaches OpenD                                                                   | `start.sh` stays in foreground but the image's PID 1 doesn't expose a usable stdin to attach. Known-broken on this image.                                                                                | Use telnet / `nc` / bash `/dev/tcp` instead. See `references/two-factor.md`.                                                                                                                                                                |
| k8s pod up but login fails silently with `>>>登录失败,网络异常`                                                                       | Cluster wraps pods in a docker bridge (kind, k3d) even though `hostNetwork: true` is set.                                                                                                                | Move to a real-host-network cluster (k3s on host, microk8s, EKS/GKE/AKS node, bare-metal kubeadm). kind is for manifest validation only.                                                                                                    |
| Pod crashlooping with `RWO` deadlock when rolling out                                                                                 | `strategy: RollingUpdate` set on a Deployment using an RWO PVC. Two pods can't mount the same PVC.                                                                                                       | Keep `strategy: Recreate` (the manifest's default). Single replica is structural.                                                                                                                                                           |
| `kubectl create secret generic ... --from-literal=FUTU_ACCOUNT_PWD_MD5=...` leaked the value to a shared host's `/proc/<pid>/cmdline` | Sub-second `argv` exposure window from `--from-literal`.                                                                                                                                                 | Use `--from-env-file=` with a `0600` file written via `umask 077`, then `shred -u` it. See `references/install-k8s.md`.                                                                                                                     |

## Signals to grep for in logs

```text
>>>API启用RSA: 是           ← good (RSA loaded)
>>>API启用RSA: 否           ← bad (futu.pem mode wrong)
>>>API监听地址              ← good (API listener bound)
>>>Telnet监听地址           ← good (2FA channel up)
>>>WebSocket监听地址        ← good (post-login, only if WebSocket enabled)
>>>登录成功                 ← good
>>>登录失败,网络异常         ← bad (bridge net OR rate-limit)
input_phone_verify_code     ← SMS prompt
input_pic_verify_code       ← CAPTCHA prompt
```

## Last-resort reset

If everything is wedged and the user has approved data loss:

```bash
# compose:
docker compose down -v && docker compose up -d --build

# docker run:
docker rm -f futu-opend
docker volume rm futu-opend-data
# then re-run install (references/install-docker-run.md)

# k8s:
kubectl delete -k k8s/
kubectl -n futu-opend delete secret futu-credentials pvc futu-opend-data 2>/dev/null
# then re-run install (references/install-k8s.md)
```

This costs a fresh SMS on the next start and (if Futu rate-limited the
account) may not recover until the cool-down expires.
