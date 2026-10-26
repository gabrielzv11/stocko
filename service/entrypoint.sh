#!/bin/sh
# Starts as root only to hand the repos volume to the unprivileged `bun` user, then drops to it: git and zoekt
# read third-party repos, so an exploit there shouldn't get root. Volumes (Railway, compose) mount owned by root;
# chown -R runs once, on the first boot that finds the dir isn't bun's yet.
set -e
repos="${REPOS_DIR:-data/repos}"
mkdir -p "$repos"
[ "$(stat -c %U "$repos")" = bun ] || chown -R bun:bun "$repos"
exec setpriv --reuid=bun --regid=bun --init-groups env HOME=/home/bun sh -c 'bunx --bun prisma migrate deploy && exec bun src/index.ts'
