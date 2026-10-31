#!/bin/bash

# Overridable so the unit test can point the script at a sandbox; containers
# always use the baked-in defaults.
FUTU_OPEND_BIN=${FUTU_OPEND_BIN:-/bin/FutuOpenD}
FUTU_OPEND_XML_SRC=${FUTU_OPEND_XML_SRC:-/bin/FutuOpenD.xml}
FUTU_OPEND_XML_PATH=${FUTU_OPEND_XML_PATH:-/tmp/FutuOpenD.xml}

FUTU_OPEND_RSA_FILE_PATH=/.futu/futu.pem
FUTU_OPEND_IP=${FUTU_OPEND_IP:-$(cat /etc/hostname)}

# Login mode selection (see README "Login modes"):
#   remember    — FUTU_OPEND_LOGIN_BY_REMEMBER=1. FutuOpenD 10.10+ reuses the
#                 password remembered by an earlier interactive login, so no
#                 password material has to reach the container.
#   password    — FUTU_ACCOUNT_PWD_MD5 (or the deprecated plaintext) is set.
#   interactive — neither is set; FutuOpenD prompts on stdin (10.10+ default).
case "$(printf '%s' "$FUTU_OPEND_LOGIN_BY_REMEMBER" | tr '[:upper:]' '[:lower:]')" in
1 | true | yes | on) FUTU_OPEND_LOGIN_BY_REMEMBER=1 ;;
'' | 0 | false | no | off) FUTU_OPEND_LOGIN_BY_REMEMBER=0 ;;
*)
  echo "ERROR: FUTU_OPEND_LOGIN_BY_REMEMBER must be 1 or 0, got '$FUTU_OPEND_LOGIN_BY_REMEMBER'." >&2
  exit 1
  ;;
esac

if [ "$FUTU_OPEND_LOGIN_BY_REMEMBER" = 1 ]; then
  LOGIN_MODE=remember
  # -login_account is mandatory for -login_by_remember=1: it selects which
  # remembered credential to replay.
  if [ -z "$FUTU_ACCOUNT_ID" ]; then
    echo "ERROR: FUTU_OPEND_LOGIN_BY_REMEMBER=1 requires FUTU_ACCOUNT_ID." >&2
    exit 1
  fi
  if [ -n "$FUTU_ACCOUNT_PWD_MD5" ] || [ -n "$FUTU_ACCOUNT_PWD" ]; then
    echo "NOTE: FUTU_OPEND_LOGIN_BY_REMEMBER=1 — password env vars are ignored." >&2
  fi
elif [ -n "$FUTU_ACCOUNT_PWD_MD5" ] || [ -n "$FUTU_ACCOUNT_PWD" ]; then
  LOGIN_MODE=password
  if [ -z "$FUTU_ACCOUNT_PWD_MD5" ]; then
    echo "WARNING: FUTU_ACCOUNT_PWD is deprecated; set FUTU_ACCOUNT_PWD_MD5 instead. See README." >&2
    FUTU_ACCOUNT_PWD_MD5=$(echo -n "$FUTU_ACCOUNT_PWD" | md5sum | awk '{print $1}')
  fi
else
  # Needs a foreground TTY to answer the prompts: `docker run -it` or
  # `docker compose run --rm futu-opend`.
  LOGIN_MODE=interactive
fi

# shellcheck disable=SC2153  # FUTU_ACCOUNT_ID is set externally (env var, not a typo of FUTU_ACCOUNT_PWD)
echo "FUTU_ACCOUNT_ID: $FUTU_ACCOUNT_ID"
echo "FUTU_OPEND_RSA_FILE_PATH: $FUTU_OPEND_RSA_FILE_PATH"
echo "FUTU_OPEND_IP: $FUTU_OPEND_IP"
echo "FUTU_OPEND_LOGIN_MODE: $LOGIN_MODE"

echo "Copy and configure FutuOpenD.xml"

cp "$FUTU_OPEND_XML_SRC" "$FUTU_OPEND_XML_PATH"

sed -i "s|<ip>.*<\/ip>|<ip>$FUTU_OPEND_IP</ip>|" "$FUTU_OPEND_XML_PATH"
sed -i "s|<api_port>.*<\/api_port>|<api_port>$FUTU_OPEND_PORT</api_port>|" "$FUTU_OPEND_XML_PATH"
# telnet_ip mirrors the API ip — under host networking, the shipped default
# `futu-opend` doesn't resolve and telnet fails to bind silently.
sed -i "s|<telnet_ip>.*<\/telnet_ip>|<telnet_ip>$FUTU_OPEND_IP</telnet_ip>|" "$FUTU_OPEND_XML_PATH"
sed -i "s|<rsa_private_key>.*<\/rsa_private_key>|<rsa_private_key>$FUTU_OPEND_RSA_FILE_PATH</rsa_private_key>|" "$FUTU_OPEND_XML_PATH"

# Keep the account in the config whenever we have one — in interactive mode it
# pre-fills the prompt, so only the password is asked for.
if [ -n "$FUTU_ACCOUNT_ID" ]; then
  sed -i "s|<login_account>.*<\/login_account>|<login_account>$FUTU_ACCOUNT_ID</login_account>|" "$FUTU_OPEND_XML_PATH"
else
  sed -i "s|<login_account>.*<\/login_account>|<!-- <login_account></login_account> -->|" "$FUTU_OPEND_XML_PATH"
fi

if [ "$LOGIN_MODE" = password ]; then
  sed -i "s|<login_pwd_md5>.*<\/login_pwd_md5>|<login_pwd_md5>$FUTU_ACCOUNT_PWD_MD5</login_pwd_md5>|" "$FUTU_OPEND_XML_PATH"
else
  # Comment the element out rather than leaving the ###…### placeholder (or an
  # empty hash) behind — otherwise OpenD attempts a password login with bogus
  # material instead of replaying the remembered one / prompting.
  sed -i "s|<login_pwd_md5>.*<\/login_pwd_md5>|<!-- <login_pwd_md5></login_pwd_md5> -->|" "$FUTU_OPEND_XML_PATH"
fi

if [ -n "$FUTU_OPEND_TELNET_PORT" ]; then
  sed -i "s|###FUTU_OPEND_TELNET_PORT###|$FUTU_OPEND_TELNET_PORT|" "$FUTU_OPEND_XML_PATH"
else
  sed -i "s|<telnet_port>.*<\/telnet_port>|<!-- <telnet_port>22222</telnet_port> -->|" "$FUTU_OPEND_XML_PATH"
fi

if [ -n "$FUTU_OPEND_WEBSOCKET_PORT" ]; then
  FUTU_OPEND_WEBSOCKET_IP=${FUTU_OPEND_WEBSOCKET_IP:-0.0.0.0}
  sed -i "s|<!-- <websocket_ip>.*</websocket_ip> -->|<websocket_ip>$FUTU_OPEND_WEBSOCKET_IP</websocket_ip>|" "$FUTU_OPEND_XML_PATH"
  sed -i "s|<!-- <websocket_port>.*</websocket_port> -->|<websocket_port>$FUTU_OPEND_WEBSOCKET_PORT</websocket_port>|" "$FUTU_OPEND_XML_PATH"
  grep -q "<websocket_port>$FUTU_OPEND_WEBSOCKET_PORT</websocket_port>" "$FUTU_OPEND_XML_PATH" || {
    echo "ERROR: failed to enable websocket in $FUTU_OPEND_XML_PATH" >&2
    exit 1
  }
fi

FUTU_OPEND_ARGS=("-cfg_file=$FUTU_OPEND_XML_PATH")
if [ "$LOGIN_MODE" = remember ]; then
  FUTU_OPEND_ARGS+=("-login_account=$FUTU_ACCOUNT_ID" "-login_by_remember=1")
fi

"$FUTU_OPEND_BIN" "${FUTU_OPEND_ARGS[@]}"
