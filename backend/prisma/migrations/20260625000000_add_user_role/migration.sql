-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'COMPLIANCE', 'ADMIN');

-- AlterTable
ALTER TABLE "User" ADD COLUMN "role" "UserRole" NOT NULL DEFAULT 'USER';
