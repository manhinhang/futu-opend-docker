# Futu OpenD Docker

lightweight futu opend docker

## Pull the docker image from docker hub

```
# default base image is ubuntu
docker pull manhinhang/futu-opend-docker
```

## Create a container from the image and run it

| You need to create [FutuOpenD.xml](https://openapi.futunn.com/futu-api-doc/opend/opend-cmd.html) file

```
docker run \
-v /bin/FutuOpenD.xml:$(pwd)/FutuOpenD.xml \
--p 11111:4002 \
futu-opend-docker
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