-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('RENTER', 'OWNER', 'BOTH');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "user_type" "UserType";
