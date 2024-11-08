# syntax=docker/dockerfile:1

ARG BASE_IMG=ubuntu

FROM ubuntu:16.04 AS base-ubuntu
FROM centos:centos7 AS base-centos

FROM base-ubuntu AS build-ubuntu
ARG FUTU_OPEND_VER=8.5.4508

WORKDIR /tmp
RUN apt-get update
RUN apt-get install -y curl 
RUN apt install -y gnutls-bin
COPY script/download_futu_opend.sh ./
RUN chmod +x ./download_futu_opend.sh
RUN ./download_futu_opend.sh Futu_OpenD_${FUTU_OPEND_VER}_Ubuntu16.04.tar.gz
RUN tar -xzf Futu_OpenD_${FUTU_OPEND_VER}_Ubuntu16.04.tar.gz

FROM base-centos AS build-centos
ARG FUTU_OPEND_VER=8.2.4218

USER root
WORKDIR /tmp
COPY script/download_futu_opend.sh ./
RUN chmod +x ./download_futu_opend.sh
RUN ./download_futu_opend.sh Futu_OpenD_${FUTU_OPEND_VER}_Centos7.tar.gz
RUN tar -xzf Futu_OpenD_${FUTU_OPEND_VER}_Centos7.tar.gz

# copy futu opend to /bin

FROM base-ubuntu AS final-ubuntu
ARG FUTU_OPEND_VER=8.2.4218

COPY --from=build-ubuntu /tmp/Futu_OpenD_${FUTU_OPEND_VER}_Ubuntu16.04/Futu_OpenD_${FUTU_OPEND_VER}_Ubuntu16.04 /bin

CMD ["/bin/start.sh"]

FROM base-centos AS final-centos
ARG FUTU_OPEND_VER=8.2.4218

COPY --from=build-centos /tmp/Futu_OpenD_${FUTU_OPEND_VER}_Centos7/Futu_OpenD_${FUTU_OPEND_VER}_Centos7 /bin

# ------------------------------------------------------------

FROM final-${BASE_IMG} AS final

ENV FUTU_ACCOUNT_ID=
ENV FUTU_ACCOUNT_PWD=
ENV FUTU_OPEND_RSA_FILE_PATH=/.futu/futu.pem
ENV FUTU_OPEND_IP=127.0.0.1
ENV FUTU_OPEND_PORT=11111
ENV FUTU_OPEND_TELNET_PORT=22222

COPY script/start.sh /bin/start.sh
RUN chmod +x /bin/start.sh

COPY FutuOpenD.xml /bin/FutuOpenD.xml

LABEL org.opencontainers.image.source=https://github.com/wuganhao/futu-opend-docker
LABEL org.opencontainers.image.description="Futu OpenD Service Image"
LABEL org.opencontainers.image.licenses=MIT

CMD ["/bin/start.sh"]

