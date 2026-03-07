#!/bin/bash

FUTU_OPEND_RSA_FILE_PATH=/.futu/futu.pem
FUTU_OPEND_IP=${FUTU_OPEND_IP:-$(cat /etc/hostname)}
FUTU_ACCOUNT_PWD_MD5=$(echo -n "$FUTU_ACCOUNT_PWD" | md5sum | awk '{print $1}')

echo "FUTO_ACCOUNT_ID: $FUTU_ACCOUNT_ID"
echo "FUTU_OPEND_RSA_FILE_PATH: $FUTU_OPEND_RSA_FILE_PATH"
echo "FUTU_OPEND_IP: $FUTU_OPEND_IP"

FUTU_OPEND_XML_SRC=/bin/FutuOpenD.xml
FUTU_OPEND_XML_PATH=/tmp/FutuOpenD.xml

echo "Copy and configure FutuOpenD.xml"

cp "$FUTU_OPEND_XML_SRC" "$FUTU_OPEND_XML_PATH"

sed -i "s|<ip>.*<\/ip>|<ip>$FUTU_OPEND_IP</ip>|" $FUTU_OPEND_XML_PATH
sed -i "s|<api_port>.*<\/api_port>|<api_port>$FUTU_OPEND_PORT</api_port>|" $FUTU_OPEND_XML_PATH
sed -i "s|<login_account>.*<\/login_account>|<login_account>$FUTU_ACCOUNT_ID</login_account>|" $FUTU_OPEND_XML_PATH
sed -i "s|<login_pwd_md5>.*<\/login_pwd_md5>|<login_pwd_md5>$FUTU_ACCOUNT_PWD_MD5</login_pwd_md5>|" $FUTU_OPEND_XML_PATH
sed -i "s|<rsa_private_key>.*<\/rsa_private_key>|<rsa_private_key>$FUTU_OPEND_RSA_FILE_PATH</rsa_private_key>|" $FUTU_OPEND_XML_PATH

if [ -n "$FUTU_OPEND_TELNET_PORT" ]; then
	sed -i "s|###FUTU_OPEND_TELNET_PORT###|$FUTU_OPEND_TELNET_PORT|" $FUTU_OPEND_XML_PATH
else
	sed -i "s|<telnet_port>.*<\/telnet_port>|<!-- <telnet_port>22222</telnet_port> -->|" $FUTU_OPEND_XML_PATH
fi

/bin/FutuOpenD -config=$FUTU_OPEND_XML_PATH
