-- AlterTable
ALTER TABLE "OAuthState" ADD COLUMN "workspaceId" TEXT;

-- DropIndex
DROP INDEX "Installation_githubInstallationId_key";

-- CreateIndex
CREATE INDEX "Installation_githubInstallationId_idx" ON "Installation"("githubInstallationId");

-- CreateIndex
CREATE UNIQUE INDEX "Installation_workspaceId_githubInstallationId_key" ON "Installation"("workspaceId", "githubInstallationId");
