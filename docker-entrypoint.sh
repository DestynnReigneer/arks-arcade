#!/bin/sh
# Starts as root only long enough to make sure the data folder belongs to the
# user the arcade runs as (PUID:PGID, default 1000:1000), then drops to that
# user for good and hands over to tini (init) and node. Nothing stays root.
#
# Why: Docker Compose creates a missing ./data on the host as root, and the
# bind mount hides the folder the image prepared, so without this a fresh
# install can't create its database ("unable to open database file").
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
case "$PUID$PGID" in
  *[!0-9]*) echo "PUID and PGID must be numbers (got PUID=$PUID PGID=$PGID)." >&2; exit 1 ;;
esac
if [ "$PUID" = "0" ]; then
  echo "PUID=0 would run the arcade as root. Use your own user's number (id -u), e.g. 1000." >&2
  exit 1
fi

if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  # Only what isn't already right, so a restart doesn't rewrite every file.
  find /app/data \( ! -user "$PUID" -o ! -group "$PGID" \) -exec chown "$PUID:$PGID" {} +
  exec su-exec "$PUID:$PGID" /sbin/tini -- "$@"
fi

# Already started as someone else (e.g. `user:` in compose): just run.
exec /sbin/tini -- "$@"
