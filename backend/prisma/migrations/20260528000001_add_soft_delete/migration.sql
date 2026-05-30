-- Add soft delete support for User and Transaction models

-- Add deletedAt column to User table
ALTER TABLE "User" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Add deletedAt column to Transaction table
ALTER TABLE "Transaction" ADD COLUMN "deletedAt" TIMESTAMP(3);

-- Add indexes for soft delete filtering
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");
CREATE INDEX "Transaction_deletedAt_idx" ON "Transaction"("deletedAt");
