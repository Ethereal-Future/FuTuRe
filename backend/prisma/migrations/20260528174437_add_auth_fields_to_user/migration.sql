-- AlterTable
ALTER TABLE "User" ADD COLUMN "username" TEXT NOT NULL DEFAULT '',
ADD COLUMN "passwordHash" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- Update to remove defaults after adding columns
ALTER TABLE "User" ALTER COLUMN "username" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP DEFAULT;
