# Futu OpenD Docker

[![Docker Pulls](https://img.shields.io/docker/pulls/manhinhang/futu-opend-docker)](https://hub.docker.com/r/manhinhang/futu-opend-docker)
[![GitHub](https://img.shields.io/github/license/manhinhang/futu-opend-docker)](https://github.com/manhinhang/futu-opend-docker/blob/main/LICENSE)

lightweight futu opend docker

## Pull the docker image from docker hub

```
# default base image is ubuntu
docker pull manhinhang/futu-opend-docker
```

## Create a container from the image and run it

| You need to create [FutuOpenD.xml](https://openapi.futunn.com/futu-api-doc/opend/opend-cmd.html) file

```bash
docker run \
-v $(pwd)/FutuOpenD.xml:/bin/FutuOpenD.xml \
-v $(pwd)/futu.pem:<RSA_KEY_PATH_IN_XML> \
--p 11111:11111 \
manhinhang/futu-opend-docker
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

This project is not affiliated with [Futu Securities International  (Hong Kong) Limited](https://www.futuhk.com/).

Good luck and enjoy.