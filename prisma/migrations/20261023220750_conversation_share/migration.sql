-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "shareToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_shareToken_key" ON "Conversation"("shareToken");
