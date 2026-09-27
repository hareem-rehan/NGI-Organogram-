-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "hasIcLadder" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "hasManagerLadder" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "positions" ADD COLUMN     "ladderKind" "CareerTrackKind";
