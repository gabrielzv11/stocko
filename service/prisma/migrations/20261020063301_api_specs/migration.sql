-- CreateTable
CREATE TABLE "ApiSpec" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "usage" TEXT NOT NULL,
    "baseUrl" TEXT,
    "authHeader" TEXT,
    "spec" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiSpec_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ApiSpec_projectId_idx" ON "ApiSpec"("projectId");

-- AddForeignKey
ALTER TABLE "ApiSpec" ADD CONSTRAINT "ApiSpec_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
