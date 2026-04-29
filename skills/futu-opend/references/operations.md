# Day-2 operations

Pick the runbook entry by the user's wording, then execute the block for
the matching target. **Always confirm before any data-loss step**
(`down -v`, `delete pvc`, `volume rm`).

## Status

```bash
# compose:
docker compose ps
docker exec futu-opend pgrep -a FutuOpenD
docker compose logs --tail=50 futu-opend

# docker run:
docker ps --filter name=futu-opend
docker exec futu-opend pgrep -a FutuOpenD
docker logs --tail=50 futu-opend

# k8s:
kubectl get pods,svc,pvc -n futu-opend
kubectl exec -n futu-opend deployment/futu-opend -- pgrep -a FutuOpenD
kubectl -n futu-opend logs --tail=50 deployment/futu-opend
```

`pgrep` is the ground truth (the shipped TCP healthcheck is broken — see
`troubleshooting.md`).

## Tail logs (live)

```bash
# compose:
docker compose logs -f --since 5m futu-opend
# docker run:
docker logs -f --since 5m futu-opend
# k8s:
kubectl -n futu-opend logs -f deployment/futu-opend
```

Useful greps: `>>>登录成功`, `>>>登录失败`, `>>>API启用RSA`, `input_phone_verify_code`.

## Restart (preserves the cached login session)

```bash
# compose:
docker compose restart futu-opend
# docker run:
docker restart futu-opend
# k8s:
kubectl -n futu-opend rollout restart deployment/futu-opend
kubectl -n futu-opend rollout status deployment/futu-opend
```

The `futu-opend-data` volume / PVC is preserved across these. Expect
**no** SMS prompt unless Futu has expired the server-side whitelist.

## Re-deliver SMS / CAPTCHA on a fresh prompt

When logs show `input_phone_verify_code` again (whitelist expired, or
state was wiped), send a fresh code via the matching route in
`references/two-factor.md`. Same procedure as install step 7.

## Bump `FUTU_OPEND_VER`

Source of truth: `opend_version.json`. Update both places when bumping.

```bash
# compose: edit FUTU_OPEND_VER in .env, then:
docker compose up -d --build

# docker run: change the image tag and recreate:
docker rm -f futu-opend
docker run -d --name futu-opend --network host \
  -e FUTU_ACCOUNT_ID=... -e FUTU_ACCOUNT_PWD_MD5=... \
  -v "$(pwd)/futu.pem:/.futu/futu.pem" \
  -v futu-opend-data:/home/futu/.com.futunn.FutuOpenD \
  ghcr.io/manhinhang/futu-opend-docker:ubuntu-<NEW_VERSION>

# k8s: edit deployment.yaml's image tag, then:
kubectl apply -k k8s/
kubectl -n futu-opend rollout status deployment/futu-opend
```

After a major version bump, FutuOpenD may invalidate the cached login —
expect a fresh SMS prompt.

## Switch base image (ubuntu ↔ centos)

Only the image tag changes; the volume and credentials are reusable.

```bash
# Pull / use the centos tag instead of ubuntu (or vice versa):
ghcr.io/manhinhang/futu-opend-docker:centos-stable

# compose: change the BASE_IMG build arg and rebuild:
docker compose build --build-arg BASE_IMG=centos
docker compose up -d
# (or pin --target=final-centos-target via docker build)

# docker run: pull and recreate as in the bump recipe above.

# k8s: edit deployment.yaml's image tag (centos-stable / centos-{ver}).
```

## Pull latest published image

```bash
# compose:
docker compose pull && docker compose up -d
# docker run:
docker pull ghcr.io/manhinhang/futu-opend-docker:ubuntu-stable
# k8s (if the deployment uses a mutable :stable tag):
kubectl -n futu-opend rollout restart deployment/futu-opend
```

`docker compose pull` is **a no-op for locally-built images** — this
repo's compose file builds locally (no `image:` directive). To pick up a
fresh build, run `docker compose build` instead.

## Tear down (preserve session)

```bash
# compose:
docker compose down
# docker run:
docker rm -f futu-opend
# k8s:
kubectl delete -k k8s/
# (Secret + PVC stay; recreate the deployment with `kubectl apply -k k8s/`.)
```

## Wipe session — forces fresh SMS on next start

**Always confirm with the user first.** This costs a fresh SMS code and
deletes the captcha / device-whitelist cache.

```bash
# compose:
docker compose down -v
# docker run:
docker rm -f futu-opend
docker volume rm futu-opend-data
# k8s:
kubectl -n futu-opend scale deployment/futu-opend --replicas=0
kubectl -n futu-opend delete pvc futu-opend-data
kubectl -n futu-opend scale deployment/futu-opend --replicas=1
```

## Rotate credentials

```bash
# compose: edit .env (FUTU_ACCOUNT_ID and/or FUTU_ACCOUNT_PWD_MD5), then:
docker compose up -d --force-recreate

# docker run: stop, recreate with new -e vars (see install-docker-run.md).

# k8s:
kubectl -n futu-opend delete secret futu-credentials
kubectl create secret generic futu-credentials \
  --namespace futu-opend \
  --from-file=futu.pem=./futu.pem \
  --from-literal=FUTU_ACCOUNT_ID="$NEW_ID" \
  --from-literal=FUTU_ACCOUNT_PWD_MD5="$NEW_MD5"
kubectl -n futu-opend rollout restart deployment/futu-opend
```

If you switched `FUTU_ACCOUNT_ID`, also wipe the data volume (see "Wipe
session") — the cached whitelist is account-bound.
