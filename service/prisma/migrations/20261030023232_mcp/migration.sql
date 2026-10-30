-- AlterTable
ALTER TABLE "RepoBranch" ADD COLUMN     "lastSyncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpCall" (
    "id" TEXT NOT NULL,
    "keyId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "projectId" TEXT,
    "ok" BOOLEAN,
    "errorCode" TEXT,
    "durationMs" INTEGER,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cachedTokens" INTEGER,
    "cost" DECIMAL(12,6),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpCall_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_workspaceId_userId_idx" ON "ApiKey"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "McpCall_keyId_createdAt_idx" ON "McpCall"("keyId", "createdAt");

-- CreateIndex
CREATE INDEX "McpCall_workspaceId_createdAt_idx" ON "McpCall"("workspaceId", "createdAt");

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpCall" ADD CONSTRAINT "McpCall_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpCall" ADD CONSTRAINT "McpCall_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
