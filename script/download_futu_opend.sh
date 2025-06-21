#! /usr/bin/env bash

URL=https://softwaredownload.futunn.com/$1
echo "downloading '${URL}'"
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
