-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "cachedTokens" INTEGER,
ADD COLUMN     "cost" DECIMAL(12,6),
ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "model" TEXT,
ADD COLUMN     "outputTokens" INTEGER;
