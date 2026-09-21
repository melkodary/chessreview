FROM node:24-alpine AS builder

ARG VITE_API_BASE
ARG VITE_DEFAULT_ANALYSIS_TIME_MS
ARG VITE_DEFAULT_REVIEW_DEPTH
ARG VITE_DEFAULT_REVIEW_MULTIPV
ENV VITE_API_BASE=$VITE_API_BASE \
    VITE_DEFAULT_ANALYSIS_TIME_MS=$VITE_DEFAULT_ANALYSIS_TIME_MS \
    VITE_DEFAULT_REVIEW_DEPTH=$VITE_DEFAULT_REVIEW_DEPTH \
    VITE_DEFAULT_REVIEW_MULTIPV=$VITE_DEFAULT_REVIEW_MULTIPV

WORKDIR /app
COPY package.json yarn.lock .yarnrc.yml ./
RUN corepack enable && yarn install --immutable
COPY . .
RUN yarn build
# Split the stable engine bundle out of dist so it lands in its own image
# layer. Vite content-hashes app assets on every build, which would otherwise
# re-store the whole dist COPY (engine included) each deploy; a disjoint engine
# layer dedups by hash and only the small app layer churns.
RUN mv dist/engine /engine-dist

# Unprivileged variant: runs as uid 101, so it cannot bind <1024 — nginx.conf
# listens on 8080/8443 and compose maps the real 80/443 onto those. Keep the
# -slim suffix: the plain -alpine unprivileged tag carries ~2x the packages.
# The mounted key.pem must be readable by uid 101.
FROM nginxinc/nginx-unprivileged:1-alpine-slim
# Engine layer first (stable — dedups across builds), app layer second (churns
# every build, but small). Two disjoint COPYs, not one.
COPY --from=builder /engine-dist /usr/share/nginx/html/engine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/security-headers.conf

EXPOSE 8080 8443
