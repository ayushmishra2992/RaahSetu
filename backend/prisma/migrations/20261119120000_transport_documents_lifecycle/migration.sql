-- Transport document lifecycle: E-Way Bill validity start and cancellation details;
-- LR advance, finalization (edit lock), terms snapshot and cancellation details.
-- Additive only: every new column is nullable, no existing data is changed.

-- AlterTable
ALTER TABLE "EwayBill" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" INTEGER,
ADD COLUMN     "validFrom" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LorryReceipt" ADD COLUMN     "advanceAmount" DOUBLE PRECISION,
ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledById" INTEGER,
ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "finalizedById" INTEGER,
ADD COLUMN     "termsSnapshot" TEXT;
