-- AlterTable
ALTER TABLE "ProjectSource" ADD COLUMN     "error" TEXT,
ADD COLUMN     "status" TEXT,
ADD COLUMN     "syncedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Chunk" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "content" TEXT NOT NULL,

    CONSTRAINT "Chunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Chunk_sourceId_idx" ON "Chunk"("sourceId");

-- AddForeignKey
ALTER TABLE "Chunk" ADD CONSTRAINT "Chunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ProjectSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
