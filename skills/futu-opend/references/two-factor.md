# 2FA — SMS and CAPTCHA delivery

FutuOpenD prompts for one of two verification codes when the device
whitelist is empty (first run, fresh PVC, after `down -v`, after Futu
expires the server-side whitelist):

- **SMS verification code** — sent to the registered phone. Command:
  `input_phone_verify_code -code=<6 digits>`.
- **Picture CAPTCHA** — PNG written inside the container at
  `/home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png`. Command:
  `input_pic_verify_code -code=<chars>`.

Both commands are sent over **telnet protocol on port 22222 with CRLF
(`\r\n`) line termination**. Bare LF is silently dropped.

The **agent must never log the code** to a tool result, transcript, or
file. Take it from the user, send it, then drop it.

## compose / `docker run` (host network)

The container binds `22222` directly on the host (host networking).

### Telnet (preferred)

```bash
echo "input_phone_verify_code -code=<CODE>" | telnet localhost 22222
```

### `nc` fallback (telnet not installed)

```bash
printf 'input_phone_verify_code -code=<CODE>\r\n' | nc -w 2 localhost 22222
```

### Bash `/dev/tcp` fallback

```bash
printf 'input_phone_verify_code -code=<CODE>\r\n' > /dev/tcp/127.0.0.1/22222
```

### Interactive (`docker attach`) — only if telnet/nc unavailable

```bash
docker attach futu-opend
input_phone_verify_code -code=<CODE>
# Detach without killing the container: Ctrl+P then Ctrl+Q
```

`docker attach` input is **unreliable on this image** — start.sh stays in
foreground but doesn't expose a usable stdin. Telnet is the supported
automation entrypoint.

## Kubernetes

### Method 1: `kubectl exec` + bash `/dev/tcp` (no port-forward)

The image ships GNU bash. This sends the command from inside the pod
itself — best for scripts and CI.

```bash
kubectl exec -n futu-opend deployment/futu-opend -- \
  bash -c 'printf "input_phone_verify_code -code=<CODE>\r\n" > /dev/tcp/127.0.0.1/22222'
```

### Method 2: `kubectl port-forward` + telnet

Useful when you also want to talk to OpenD from the host while delivering
the code.

```bash
# In one shell (keep open):
kubectl port-forward -n futu-opend deployment/futu-opend 22222:22222

# In another:
echo "input_phone_verify_code -code=<CODE>" | telnet localhost 22222
```

### Method 3: `kubectl attach -it` (interactive fallback)

Inherits the same unreliable-stdin issue as `docker attach`. Use only as
a last resort.

```bash
kubectl attach -it -n futu-opend deployment/futu-opend
input_phone_verify_code -code=<CODE>
# Detach: Ctrl+P then Ctrl+Q
```

## Picture CAPTCHA

When OpenD prompts for `input_pic_verify_code`, pull the PNG out, view it
locally, then send the code via any of the routes above (the command name
is the only difference).

### compose / `docker run`

```bash
docker cp futu-opend:/home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png ./PicVerifyCode.png
# View ./PicVerifyCode.png
echo "input_pic_verify_code -code=<CHARS>" | telnet localhost 22222
```

### Kubernetes (kubectl cp)

```bash
POD=$(kubectl -n futu-opend get pod -l app=futu-opend -o jsonpath='{.items[0].metadata.name}')
# Note: kubectl cp drops the leading slash on the source path.
kubectl cp futu-opend/$POD:home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png ./PicVerifyCode.png
# View ./PicVerifyCode.png
kubectl exec -n futu-opend deployment/futu-opend -- \
  bash -c 'printf "input_pic_verify_code -code=<CHARS>\r\n" > /dev/tcp/127.0.0.1/22222'
```

## E2E harness file-drop (test runs only)

`script/e2e.test.mjs` reads SMS codes from `/tmp/futu-sms-code` (polled
every 1 s, 5 min budget) for non-TTY runs. This is **test-only** — do not
use it as a user-facing install path.

## Confirming the code was accepted

There is no protocol-level reply. Tail the logs:

```bash
# compose / docker run:
docker logs --since 30s futu-opend | grep -E '登录|>>>API|verify'
# k8s:
kubectl -n futu-opend logs --since=30s deployment/futu-opend | grep -E '登录|>>>API|verify'
```

Pass: `>>>API监听地址` appears, no `>>>登录失败` after the latest code.
Fail: another `input_phone_verify_code` prompt → wrong code, or the
previous one was sent without CRLF.
