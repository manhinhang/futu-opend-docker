# syntax=docker/dockerfile:1

ARG BASE_IMG=ubuntu

FROM ubuntu:16.04 as base-ubuntu
FROM centos:centos7 as base-centos

FROM base-ubuntu as build-ubuntu
ARG FUTU_OPEND_VER=7.1.3308

WORKDIR /tmp
ADD https://softwarefile.futunn.com/FutuOpenD_${FUTU_OPEND_VER}_NN_Ubuntu16.04.tar.gz ./
RUN tar -xzf FutuOpenD_${FUTU_OPEND_VER}_NN_Ubuntu16.04.tar.gz \
 && rm FutuOpenD_${FUTU_OPEND_VER}_NN_Ubuntu16.04.tar.gz

FROM base-centos as build-centos
ARG FUTU_OPEND_VER=7.1.3308

WORKDIR /tmp
ADD https://softwarefile.futunn.com/FutuOpenD_${FUTU_OPEND_VER}_NN_Centos7.tar.gz ./
RUN tar -xzf FutuOpenD_${FUTU_OPEND_VER}_NN_Centos7.tar.gz \
 && rm FutuOpenD_${FUTU_OPEND_VER}_NN_Centos7.tar.gz

FROM base-ubuntu AS final-ubuntu
ARG FUTU_OPEND_VER=7.1.3308

CMD ["/bin/FutuOpenD"]

COPY --from=build-ubuntu /tmp/FutuOpenD_${FUTU_OPEND_VER}_NN_Ubuntu16.04/FutuOpenD_${FUTU_OPEND_VER}_NN_Ubuntu16.04 /bin

FROM base-centos AS final-centos
ARG FUTU_OPEND_VER=7.1.3308

CMD ["/bin/FutuOpenD"]

COPY --from=build-centos /tmp/FutuOpenD_${FUTU_OPEND_VER}_NN_Centos7/FutuOpenD_${FUTU_OPEND_VER}_NN_Centos7 /bin


FROM final-${BASE_IMG} AS final

