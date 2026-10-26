-- Invites by GitHub login become codes/links; pending login invites are dropped.
DELETE FROM "Invite";

-- DropIndex
DROP INDEX "Invite_login_idx";

-- DropIndex
DROP INDEX "Invite_workspaceId_login_key";

-- AlterTable
ALTER TABLE "Invite" DROP COLUMN "login",
ADD COLUMN     "code" TEXT NOT NULL,
ADD COLUMN     "expiresAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Invite_code_key" ON "Invite"("code");

-- CreateIndex
CREATE INDEX "Invite_workspaceId_idx" ON "Invite"("workspaceId");
