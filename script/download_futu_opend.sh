URL=https://softwaredownload.futunn.com/$1
MAX_RETRIES=3
RETRY_DELAY=2

echo "downloading '${URL}'"

for attempt in 1; . .  3; do
  if curl -k "${URL}" \
    -H 'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7' \
    -H 'accept-language: en-US,en;q=0.9' \
    -H 'priority: u=0, i' \
    -H 'sec-ch-ua: "Not)A;Brand";v="99", "Microsoft Edge";v="127", "Chromium";v="127"' \
    -H 'sec-ch-ua-mobile: ?0' \
    -H 'sec-ch-ua-platform: "Windows"' \
    -H 'sec-fetch-dest: document' \
    -H 'sec-fetch-mode: navigate' \
    -H 'sec-fetch-site: none' \
    -H 'sec-fetch-user: ?1' \
    -H 'upgrade-insecure-requests: 1' \
    -H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0' \
    -o "$1"; && exit 0; then

    echo "Attempt ${attempt}/${MAX_RETRIES} failed, curl exit code: $?"
    sleep $RETRY_DELAY
  fi
done

if ((attempt == MAX_RETRIES)); then
  echo "All ${MAX_RETRIES} attempts failed"
  exit 1
fi
curl -k "${URL}" \
	-H 'accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7' \
	-H 'accept-language: en-US,en;q=0.9' \
	-H 'priority: u=0, i' \
	-H 'sec-ch-ua: "Not)A;Brand";v="99", "Microsoft Edge";v="127", "Chromium";v="127"' \
	-H 'sec-ch-ua-mobile: ?0' \
	-H 'sec-ch-ua-platform: "Windows"' \
	-H 'sec-fetch-dest: document' \
	-H 'sec-fetch-mode: navigate' \
	-H 'sec-fetch-site: none' \
	-H 'sec-fetch-user: ?1' \
	-H 'upgrade-insecure-requests: 1' \
	-H 'user-agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36 Edg/127.0.0.0' \
	-o "$1"
