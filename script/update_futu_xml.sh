#!/bin/sh

acc_id=$1
rsa_key=$2
pwd_md5=$(echo -n $3 | md5sum | awk '{print $1}')

echo "Account Id: $acc_id"
echo "RSA key path: $rsa_key"
echo "Password md5: $pwd_md5"

# The XML string
xml_str=$(cat FutuOpenD.xml)

#######################
## Update Account Id
#######################

# Define the regex pattern to match the element content
pattern='<login_account>.*<\/login_account>'

# Use the grep command to find the old value in the XML string
old_value=$(echo "$xml_str" | grep -o "$pattern")

# Use the sed command to replace the old value with the new value
xml_str=$(echo "$xml_str" | sed "s|$old_value|<login_account>$acc_id</login_account>|")

#######################
## Update RSA key path
#######################

# Define the regex pattern to match the element content
pattern='<rsa_private_key>.*<\/rsa_private_key>'

# Use the grep command to find the old value in the XML string
old_value=$(echo "$xml_str" | grep -o "$pattern")

# Use the sed command to replace the old value with the new value
xml_str=$(echo "$xml_str" | sed "s|$old_value|<rsa_private_key>$rsa_key</rsa_private_key>|")

#######################
## Update password md5
#######################

# Define the regex pattern to match the element content
pattern='<login_pwd_md5>.*<\/login_pwd_md5>'

# Use the grep command to find the old value in the XML string
old_value=$(echo "$xml_str" | grep -o "$pattern")

xml_str=$(echo "$xml_str" | sed "s|$old_value|<login_pwd_md5>$pwd_md5</login_pwd_md5>|")

# Print the new XML string
echo "$xml_str" > FutuOpenD.xml