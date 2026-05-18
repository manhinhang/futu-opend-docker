#!/bin/bash

FUTU_OPEND_RSA_FILE_PATH=/.futu/futu.pem
FUTU_OPEND_IP=${FUTU_OPEND_IP:-$(cat /etc/hostname)}
FUTU_OPEND_PORT=${FUTU_OPEND_PORT:-11111}
FUTU_OPEND_LANG=${FUTU_OPEND_LANG:-chs}
FUTU_OPEND_LOG_LEVEL=${FUTU_OPEND_LOG_LEVEL:-info}

if [ -z "$FUTU_ACCOUNT_PWD_MD5" ]; then
  if [ -n "$FUTU_ACCOUNT_PWD" ]; then
    echo "WARNING: FUTU_ACCOUNT_PWD is deprecated; set FUTU_ACCOUNT_PWD_MD5 instead. See README." >&2
  fi
  FUTU_ACCOUNT_PWD_MD5=$(echo -n "$FUTU_ACCOUNT_PWD" | md5sum | awk '{print $1}')
fi

# shellcheck disable=SC2153  # FUTU_ACCOUNT_ID is set externally (env var, not a typo of FUTU_ACCOUNT_PWD)
echo "FUTU_ACCOUNT_ID: $FUTU_ACCOUNT_ID"
echo "FUTU_OPEND_RSA_FILE_PATH: $FUTU_OPEND_RSA_FILE_PATH"
echo "FUTU_OPEND_IP: $FUTU_OPEND_IP"

FUTU_OPEND_XML_PATH=/tmp/FutuOpenD.xml

echo "Generating FutuOpenD.xml from environment variables"

# telnet_ip mirrors the API ip — under host networking a non-resolvable
# default makes telnet fail to bind silently.
if [ -n "$FUTU_OPEND_TELNET_PORT" ]; then
  TELNET_CONFIG="<telnet_ip>$FUTU_OPEND_IP</telnet_ip>
	<telnet_port>$FUTU_OPEND_TELNET_PORT</telnet_port>"
else
  TELNET_CONFIG=""
fi

if [ -n "$FUTU_OPEND_WEBSOCKET_PORT" ]; then
  FUTU_OPEND_WEBSOCKET_IP=${FUTU_OPEND_WEBSOCKET_IP:-127.0.0.1}
  WEBSOCKET_CONFIG="<websocket_ip>$FUTU_OPEND_WEBSOCKET_IP</websocket_ip>
	<websocket_port>$FUTU_OPEND_WEBSOCKET_PORT</websocket_port>"
else
  WEBSOCKET_CONFIG=""
fi

cat >"$FUTU_OPEND_XML_PATH" <<EOF
<futu_opend>
	<ip>$FUTU_OPEND_IP</ip>
	<api_port>$FUTU_OPEND_PORT</api_port>
	<login_account>$FUTU_ACCOUNT_ID</login_account>
	<login_pwd_md5>$FUTU_ACCOUNT_PWD_MD5</login_pwd_md5>
	<lang>$FUTU_OPEND_LANG</lang>
	<log_level>$FUTU_OPEND_LOG_LEVEL</log_level>
	<push_proto_type>0</push_proto_type>
	$TELNET_CONFIG
	<rsa_private_key>$FUTU_OPEND_RSA_FILE_PATH</rsa_private_key>
	<price_reminder_push>1</price_reminder_push>
	<auto_hold_quote_right>1</auto_hold_quote_right>
	<future_trade_api_time_zone>UTC+8</future_trade_api_time_zone>
	$WEBSOCKET_CONFIG
	<pdt_protection>1</pdt_protection>
	<dtcall_confirmation>1</dtcall_confirmation>
</futu_opend>
EOF

if [ -n "$FUTU_OPEND_WEBSOCKET_PORT" ]; then
  grep -q "<websocket_port>$FUTU_OPEND_WEBSOCKET_PORT</websocket_port>" "$FUTU_OPEND_XML_PATH" || {
    echo "ERROR: failed to enable websocket in $FUTU_OPEND_XML_PATH" >&2
    exit 1
  }
fi

/bin/FutuOpenD -cfg_file=$FUTU_OPEND_XML_PATH
