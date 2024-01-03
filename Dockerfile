# syntax=docker/dockerfile:1

ARG BASE_IMG=ubuntu

FROM ubuntu:16.04 as base-ubuntu
FROM centos:centos7 as base-centos

FROM base-ubuntu as build-ubuntu
ARG FUTU_OPEND_VER=7.1.3308

WORKDIR /tmp
ADD https://softwaredownload.futunn.com/Futu_OpenD_${FUTU_OPEND_VER}_Ubuntu16.04.tar.gz ./
RUN tar -xzf Futu_OpenD_${FUTU_OPEND_VER}_Ubuntu16.04.tar.gz \
 && rm Futu_OpenD_${FUTU_OPEND_VER}_Ubuntu16.04.tar.gz

FROM base-centos as build-centos
ARG FUTU_OPEND_VER=7.1.3308

WORKDIR /tmp
ADD https://softwaredownload.futunn.com/Futu_OpenD_${FUTU_OPEND_VER}_Centos7.tar.gz ./
RUN tar -xzf Futu_OpenD_${FUTU_OPEND_VER}_Centos7.tar.gz \
 && rm Futu_OpenD_${FUTU_OPEND_VER}_Centos7.tar.gz

FROM base-ubuntu AS final-ubuntu
ARG FUTU_OPEND_VER=7.1.3308

CMD ["/bin/FutuOpenD"]

COPY --from=build-ubuntu /tmp/Futu_OpenD_${FUTU_OPEND_VER}_Ubuntu16.04/Futu_OpenD_${FUTU_OPEND_VER}_Ubuntu16.04 /bin

FROM base-centos AS final-centos
ARG FUTU_OPEND_VER=7.1.3308

CMD ["/bin/FutuOpenD"]

COPY --from=build-centos /tmp/Futu_OpenD_${FUTU_OPEND_VER}_Centos7/Futu_OpenD_${FUTU_OPEND_VER}_Centos7 /bin


FROM final-${BASE_IMG} AS final

