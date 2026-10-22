# syntax=docker/dockerfile:1

FROM node:22-alpine

# Tini reaps zombies and forwards signals, so `docker compose stop` actually
# stops the process instead of waiting out the 10s kill timeout.
RUN apk add --no-cache tini wget su-exec

WORKDIR /app

# Dependencies first, so editing game code doesn't re-run npm on every build.
# Plain `npm ci` fails the build if package-lock.json is out of step with
# package.json, so the image always holds exactly the locked versions.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY db.js server.js ./
COPY rambler ./rambler
COPY arcade ./arcade
COPY chess ./chess
COPY spinsolve ./spinsolve
COPY trivia ./trivia
COPY partdeux ./partdeux
COPY daredevil ./daredevil
COPY words ./words
COPY public ./public

# The SQLite file is the only state, in /app/data. docker-entrypoint.sh gives
# that folder to PUID:PGID on every start (a mounted ./data covers whatever
# the image prepared), then drops to that user. Only that folder: the code
# stays root-owned, so the app can't rewrite itself.
RUN mkdir -p /app/data && chown node:node /app/data
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# No USER line: the entrypoint drops privileges itself, before tini and node.

# Reports unhealthy if the word lists failed to load, not merely if the port
# is open -- a listening process with no dictionary is the failure that would
# otherwise look fine from outside.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null 2>&1 || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
