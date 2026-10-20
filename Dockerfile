FROM oven/bun:1.2.22
# git: repo sync and the agent's grep tool (git grep -P)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bunx --bun prisma generate
EXPOSE 8000
CMD ["sh", "-c", "bunx --bun prisma migrate deploy && bun src/index.ts"]
