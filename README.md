# Futu OpenD Docker

[![Docker Pulls](https://img.shields.io/github/package-json/v/manhinhang/futu-opend-docker)](https://github.com/manhinhang/futu-opend-docker/packages)
[![GitHub](https://img.shields.io/github/license/manhinhang/futu-opend-docker)](https://github.com/manhinhang/futu-opend-docker/blob/main/LICENSE)

lightweight futu opend docker

## Pull the docker image from GitHub Container Registry

```
# default base image is ubuntu
docker pull ghcr.io/manhinhang/futu-opend-docker:ubuntu-stable
```

## container tags pattern

| Base Image | Tags                   |
| ---------- | ---------------------- |
| ubuntu     | ubuntu-stable          |
| ubuntu     | ubuntu-beta            |
| ubuntu     | ubuntu-{opend_version} |
| centos     | centos-stable          |
| centos     | centos-beta            |
| centos     | centos-{opend_version} |

## Create a container from the image and run it

> You need to create [FutuOpenD.xml](https://openapi.futunn.com/futu-api-doc/opend/opend-cmd.html) file
> generate your own RSA key
>
> ```bash
> openssl genrsa -out futu.pem 1024
> ```

PEM file should config in XML

```xml
...
<rsa_private_key>/bin/futu.pem</rsa_private_key>
...
```

```bash
docker run -it \
-v $(pwd)/FutuOpenD.xml:/bin/FutuOpenD.xml \
-v $(pwd)/futu.pem:/bin/futu.pem \
-p 11111:11111 \
ghcr.io/manhinhang/futu-opend-docker
```

### Input 2FA code

1. Attach to futu opend continer

```bash
docker attach futu-opend-docker
```

2. Input received SMS passcode

```
input_phone_verify_code -code=<2FA_CODE>
```

## Run in docker compose

Edit `.env`

| Enviroment Variable | Description                     |
| ------------------- | ------------------------------- |
| FUTU_ACCOUNT_ID     | Futu account ID                 |
| FUTU_ACCOUNT_PWD    | Futu account password           |
| FUTU_RSA_FILE_PATH  | Futu RSA file path in container |
| FUTU_OPEND_IP       | Futu OpenD IP in container      |
| FUTU_OPEND_PORT     | Futu OpenD Port in container    |

```bash
docker compose up -d
```

Then enter 2FA code

```bash
docker attach futu-opend
input_phone_verify_code -code=<2FA_CODE>
```

## Build locally

- Use ubuntu as base image

```
docker build -t futu-opend-docker --build-arg FUTU_OPEND_VER=7.1.3308 --build-arg BASE_IMG=ubuntu .
```

- Use centos as base image

```
docker build -t futu-opend-docker --build-arg FUTU_OPEND_VER=7.1.3308 --build-arg BASE_IMG=centos .
```

## Disclaimer

This project is not affiliated with [Futu Securities International (Hong Kong) Limited](https://www.futuhk.com/).

Good luck and enjoy.
