# syntax=docker/dockerfile:1

ARG BASE_IMG=ubuntu

FROM ubuntu:16.04 AS base-ubuntu
FROM centos:centos7 AS base-centos

FROM base-ubuntu AS build-ubuntu
ARG FUTU_OPEND_VER=9.4.5418

WORKDIR /tmp
RUN apt-get update && \
    apt-get install --no-install-recommends -y curl=7.47.0-1ubuntu2.19 gnutls-bin=3.4.10-4ubuntu1
COPY script/download_futu_opend.sh ./
RUN chmod +x ./download_futu_opend.sh && \
    ./download_futu_opend.sh Futu_OpenD_${FUTU_OPEND_VER}_Ubuntu16.04.tar.gz && \
    tar -xzf Futu_OpenD_${FUTU_OPEND_VER}_Ubuntu16.04.tar.gz

FROM base-centos AS build-centos
ARG FUTU_OPEND_VER=9.4.5418

WORKDIR /tmp
COPY script/download_futu_opend.sh ./
RUN chmod +x ./download_futu_opend.sh && \
    ./download_futu_opend.sh Futu_OpenD_${FUTU_OPEND_VER}_Centos7.tar.gz && \
    tar -xzf Futu_OpenD_${FUTU_OPEND_VER}_Centos7.tar.gz

# copy futu opend to /bin

FROM base-ubuntu AS final-ubuntu
ARG FUTU_OPEND_VER=9.4.5418

COPY --from=build-ubuntu /tmp/Futu_OpenD_${FUTU_OPEND_VER}_Ubuntu16.04/Futu_OpenD_${FUTU_OPEND_VER}_Ubuntu16.04 /bin

CMD ["/bin/start.sh"]

FROM base-centos AS final-centos
ARG FUTU_OPEND_VER=9.4.5418

COPY --from=build-centos /tmp/Futu_OpenD_${FUTU_OPEND_VER}_Centos7/Futu_OpenD_${FUTU_OPEND_VER}_Centos7 /bin

# ------------------------------------------------------------
# Ubuntu final image
FROM final-ubuntu AS final-ubuntu-image

ENV FUTU_ACCOUNT_ID=
ENV FUTU_ACCOUNT_PWD=
ENV FUTU_OPEND_RSA_FILE_PATH=/.futu/futu.pem
ENV FUTU_OPEND_IP=127.0.0.1
ENV FUTU_OPEND_PORT=11111
ENV FUTU_OPEND_TELNET_PORT=22222

# Create non-root user and necessary directories
RUN groupadd -r futu && useradd -r -g futu -m -d /home/futu futu && \
    mkdir -p /.futu /bin && chown -R futu:futu /.futu /bin /home/futu

COPY script/start.sh /bin/start.sh
RUN chmod +x /bin/start.sh && chown futu:futu /bin/start.sh

COPY FutuOpenD.xml /bin/FutuOpenD.xml
RUN chown futu:futu /bin/FutuOpenD.xml

# Switch to non-root user
USER futu

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=600s --start-period=180s --retries=3 \
  CMD pgrep FutuOpenD || exit 1

CMD ["/bin/start.sh"]

# ------------------------------------------------------------
# CentOS final image
FROM final-centos AS final-centos-image

ENV FUTU_ACCOUNT_ID=
ENV FUTU_ACCOUNT_PWD=
ENV FUTU_OPEND_RSA_FILE_PATH=/.futu/futu.pem
ENV FUTU_OPEND_IP=127.0.0.1
ENV FUTU_OPEND_PORT=11111
ENV FUTU_OPEND_TELNET_PORT=22222

# Create non-root user and necessary directories
RUN groupadd -r futu && useradd -r -g futu -m -d /home/futu futu && \
    mkdir -p /.futu /bin && chown -R futu:futu /.futu /bin /home/futu

COPY script/start.sh /bin/start.sh
RUN chmod +x /bin/start.sh && chown futu:futu /bin/start.sh

COPY FutuOpenD.xml /bin/FutuOpenD.xml
RUN chown futu:futu /bin/FutuOpenD.xml

# Switch to non-root user
USER futu

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=600s --start-period=180s --retries=3 \
  CMD pgrep FutuOpenD || exit 1

CMD ["/bin/start.sh"]

# ------------------------------------------------------------
# Final image selection based on BASE_IMG argument
FROM final-ubuntu-image AS final-ubuntu-target
FROM final-centos-image AS final-centos-target

# Default to Ubuntu if BASE_IMG is not specified or invalid
FROM final-ubuntu-target AS final

