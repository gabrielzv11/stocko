/*
  Warnings:

  - You are about to drop the column `projectId` on the `Conversation` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_projectId_fkey";

-- DropIndex
DROP INDEX "Conversation_projectId_updatedAt_idx";

-- AlterTable
ALTER TABLE "Conversation" DROP COLUMN "projectId";

-- CreateTable
CREATE TABLE "_ConversationToProject" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ConversationToProject_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ConversationToProject_B_index" ON "_ConversationToProject"("B");

-- AddForeignKey
ALTER TABLE "_ConversationToProject" ADD CONSTRAINT "_ConversationToProject_A_fkey" FOREIGN KEY ("A") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ConversationToProject" ADD CONSTRAINT "_ConversationToProject_B_fkey" FOREIGN KEY ("B") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
