#!/usr/bin/env bash

URL=https://softwaredownload.futunn.com/$1
MAX_RETRIES=3
RETRY_DELAY=2

echo "downloading '${URL}'"

for ((attempt = 1; attempt <= MAX_RETRIES; attempt++)); do
  if curl -k "${URL}" \
    -H 'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7' \
    -H 'accept-language: en-US,en;q=0.9' \
    -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36' \
    -o "$1"; then
    echo "Download successful on attempt ${attempt}"
    exit 0
  fi

  echo "Attempt ${attempt}/${MAX_RETRIES} failed, curl exit code: $?"
  if ((attempt < MAX_RETRIES)); then
    echo "Retrying in ${RETRY_DELAY}s..."
    sleep $RETRY_DELAY
  fi
done

echo "All ${MAX_RETRIES} attempts failed"
exit 1
