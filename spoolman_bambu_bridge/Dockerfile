ARG BUILD_FROM=node:22-alpine
FROM ${BUILD_FROM}
RUN command -v node >/dev/null || apk add --no-cache nodejs
WORKDIR /opt/bridge
COPY app/ ./
ENV DATA_DIR=/data PORT=8099 INGRESS_ONLY=1
HEALTHCHECK --interval=30s --timeout=5s CMD node healthcheck.mjs
CMD ["node", "server.mjs"]
