-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "llmModel" TEXT,
ADD COLUMN     "llmProvider" TEXT NOT NULL DEFAULT 'openrouter',
ADD COLUMN     "mangabaApiKey" TEXT;
