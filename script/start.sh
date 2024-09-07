#!/bin/bash

FUTU_OPEND_RSA_FILE_PATH=/.futu/futu.pem
FUTU_OPEND_IP=$(cat /etc/hostname)
FUTU_ACCOUNT_PWD_MD5=$(echo -n $FUTU_ACCOUNT_PWD | md5sum | awk '{print $1}')

echo "FUTO_ACCOUNT_ID: $FUTU_ACCOUNT_ID"
echo "FUTO_ACCOUNT_PWD: $FUTU_ACCOUNT_PWD"
echo "FUTU_ACCOUNT_PWD_MD5: $FUTU_ACCOUNT_PWD_MD5"
echo "FUTU_OPEND_RSA_FILE_PATH: $FUTU_OPEND_RSA_FILE_PATH"
echo "FUTU_OPEND_IP: $FUTU_OPEND_IP"

# sh /bin/update_futu_xml.sh $FUTU_ACCOUNT_ID $FUTU_ACCOUNT_PWD $FUTU_OPEND_RSA_FILE_PATH
FUTU_OPEND_XML_PATH=/bin/FutuOpenD.xml

sed -i "s|<ip>.*<\/ip>|<ip>$FUTU_OPEND_IP</ip>|" $FUTU_OPEND_XML_PATH
sed -i "s|<login_account>.*<\/login_account>|<login_account>$FUTU_ACCOUNT_ID</login_account>|" $FUTU_OPEND_XML_PATH
sed -i "s|<login_pwd_md5>.*<\/login_pwd_md5>|<login_pwd_md5>$FUTU_ACCOUNT_PWD_MD5</login_pwd_md5>|" $FUTU_OPEND_XML_PATH
sed -i "s|<rsa_private_key>.*<\/rsa_private_key>|<rsa_private_key>$FUTU_OPEND_RSA_FILE_PATH</rsa_private_key>|" $FUTU_OPEND_XML_PATH

cat $FUTU_OPEND_XML_PATH

echo "----------------------------------------"

/bin/FutuOpenD
