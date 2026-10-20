// Run the CLI through Bun (`bunx --bun prisma ...`) so .env is loaded automatically.
import { defineConfig } from 'prisma/config';

export default defineConfig({
	schema: 'prisma/schema.prisma',
	migrations: { path: 'prisma/migrations' },
	datasource: { url: process.env.DATABASE_URL },
});
