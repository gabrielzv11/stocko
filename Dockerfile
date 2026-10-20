# Zoekt (GREP_BACKEND=zoekt): static binaries, pinned to sourcegraph/zoekt@153817f (2026-09-11), Apache-2.0.
FROM golang:1.25-bookworm AS zoekt
ENV CGO_ENABLED=0 GOTOOLCHAIN=auto
RUN go install \
	github.com/sourcegraph/zoekt/cmd/zoekt@v0.0.0-20260911061844-153817f643cd \
	github.com/sourcegraph/zoekt/cmd/zoekt-git-index@v0.0.0-20260911061844-153817f643cd

FROM oven/bun:1.2.22
# git: repo sync and the agent's tools (ls-tree / git grep -P / cat-file on the bare repo)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=zoekt /go/bin/zoekt /go/bin/zoekt-git-index /usr/local/bin/
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bunx --bun prisma generate
EXPOSE 8000
CMD ["sh", "-c", "bunx --bun prisma migrate deploy && bun src/index.ts"]
