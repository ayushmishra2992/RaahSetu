-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AttachmentRole" AS ENUM ('FRONT', 'BACK', 'PAGE', 'PHOTO', 'SIGNATURE');

-- CreateEnum
CREATE TYPE "OwnershipType" AS ENUM ('OWNED', 'LEASED', 'ATTACHED');

-- CreateEnum
CREATE TYPE "PodStatus" AS ENUM ('DELIVERED', 'PARTIALLY_DELIVERED', 'FAILED', 'RETURNED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "FreightPaymentTerms" AS ENUM ('PAID', 'TO_PAY', 'TO_BE_BILLED');

-- CreateEnum
CREATE TYPE "ShipmentDocStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "DocumentType" ADD VALUE 'STATE_PERMIT';
ALTER TYPE "DocumentType" ADD VALUE 'FASTAG';
ALTER TYPE "DocumentType" ADD VALUE 'DRIVER_PHOTO';
ALTER TYPE "DocumentType" ADD VALUE 'KYC_ID';

-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "fastagId" TEXT,
ADD COLUMN     "ownerName" TEXT,
ADD COLUMN     "ownerPhone" TEXT,
ADD COLUMN     "ownershipType" "OwnershipType" NOT NULL DEFAULT 'OWNED',
ADD COLUMN     "registrationState" TEXT;

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "address" TEXT,
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT,
ADD COLUMN     "kycConsentAt" TIMESTAMP(3),
ADD COLUMN     "kycConsentById" INTEGER,
ADD COLUMN     "kycIdLast4" TEXT,
ADD COLUMN     "kycIdType" TEXT,
ADD COLUMN     "kycVerification" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "licenseClass" TEXT,
ADD COLUMN     "licenseIssuedOn" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "ComplianceDocument" ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedById" INTEGER;

-- AlterTable
ALTER TABLE "BillingDocument" ADD COLUMN     "reasonForTransport" TEXT,
ADD COLUMN     "referenceDocuments" TEXT;

-- AlterTable
ALTER TABLE "BillingItem" ADD COLUMN     "hsnCode" TEXT;

-- CreateTable
CREATE TABLE "Attachment" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "role" "AttachmentRole" NOT NULL DEFAULT 'PAGE',
    "fileName" TEXT NOT NULL,
    "fileMimeType" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" INTEGER,
    "complianceDocumentId" INTEGER,
    "ewayBillId" INTEGER,
    "podId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EwayBill" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "orderId" INTEGER NOT NULL,
    "tripId" INTEGER,
    "ewbNumber" TEXT NOT NULL,
    "documentDate" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "supplierName" TEXT NOT NULL,
    "supplierGstin" TEXT,
    "recipientName" TEXT NOT NULL,
    "recipientGstin" TEXT,
    "placeOfDispatch" TEXT NOT NULL,
    "placeOfDelivery" TEXT NOT NULL,
    "goodsDescription" TEXT NOT NULL,
    "hsnCode" TEXT,
    "quantity" DOUBLE PRECISION,
    "quantityUnit" TEXT,
    "taxableValue" DOUBLE PRECISION,
    "invoiceOrChallanRef" TEXT,
    "transporterId" TEXT,
    "vehicleNumber" TEXT,
    "transportDocNumber" TEXT,
    "status" "ShipmentDocStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EwayBill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LorryReceipt" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "lrNumber" TEXT NOT NULL,
    "orderId" INTEGER NOT NULL,
    "tripId" INTEGER,
    "bookingDate" TIMESTAMP(3) NOT NULL,
    "consignorName" TEXT NOT NULL,
    "consignorAddress" TEXT,
    "consignorGstin" TEXT,
    "consigneeName" TEXT NOT NULL,
    "consigneeAddress" TEXT,
    "consigneeGstin" TEXT,
    "fromPlace" TEXT NOT NULL,
    "toPlace" TEXT NOT NULL,
    "goodsDescription" TEXT NOT NULL,
    "packages" INTEGER,
    "packageType" TEXT,
    "actualWeightKg" DOUBLE PRECISION,
    "chargedWeightKg" DOUBLE PRECISION,
    "freightAmount" DOUBLE PRECISION,
    "paymentTerms" "FreightPaymentTerms" NOT NULL DEFAULT 'TO_BE_BILLED',
    "declaredValue" DOUBLE PRECISION,
    "deliveryInstructions" TEXT,
    "status" "ShipmentDocStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LorryReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofOfDelivery" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "tripId" INTEGER NOT NULL,
    "tripStopId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "status" "PodStatus" NOT NULL,
    "receiverName" TEXT NOT NULL,
    "receiverPhone" TEXT,
    "deliveredAt" TIMESTAMP(3) NOT NULL,
    "deliveredQuantity" DOUBLE PRECISION,
    "shortageDetails" TEXT,
    "damageDetails" TEXT,
    "remarks" TEXT,
    "recordedById" INTEGER,
    "verificationToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProofOfDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_companyId_idx" ON "Attachment"("companyId");

-- CreateIndex
CREATE INDEX "Attachment_complianceDocumentId_idx" ON "Attachment"("complianceDocumentId");

-- CreateIndex
CREATE INDEX "Attachment_ewayBillId_idx" ON "Attachment"("ewayBillId");

-- CreateIndex
CREATE INDEX "Attachment_podId_idx" ON "Attachment"("podId");

-- CreateIndex
CREATE INDEX "EwayBill_companyId_orderId_idx" ON "EwayBill"("companyId", "orderId");

-- CreateIndex
CREATE INDEX "EwayBill_companyId_validUntil_idx" ON "EwayBill"("companyId", "validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "EwayBill_companyId_ewbNumber_key" ON "EwayBill"("companyId", "ewbNumber");

-- CreateIndex
CREATE INDEX "LorryReceipt_companyId_orderId_idx" ON "LorryReceipt"("companyId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "LorryReceipt_companyId_lrNumber_key" ON "LorryReceipt"("companyId", "lrNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ProofOfDelivery_tripStopId_key" ON "ProofOfDelivery"("tripStopId");

-- CreateIndex
CREATE UNIQUE INDEX "ProofOfDelivery_verificationToken_key" ON "ProofOfDelivery"("verificationToken");

-- CreateIndex
CREATE INDEX "ProofOfDelivery_companyId_tripId_idx" ON "ProofOfDelivery"("companyId", "tripId");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_complianceDocumentId_fkey" FOREIGN KEY ("complianceDocumentId") REFERENCES "ComplianceDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_ewayBillId_fkey" FOREIGN KEY ("ewayBillId") REFERENCES "EwayBill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_podId_fkey" FOREIGN KEY ("podId") REFERENCES "ProofOfDelivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EwayBill" ADD CONSTRAINT "EwayBill_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EwayBill" ADD CONSTRAINT "EwayBill_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EwayBill" ADD CONSTRAINT "EwayBill_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LorryReceipt" ADD CONSTRAINT "LorryReceipt_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LorryReceipt" ADD CONSTRAINT "LorryReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LorryReceipt" ADD CONSTRAINT "LorryReceipt_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfDelivery" ADD CONSTRAINT "ProofOfDelivery_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfDelivery" ADD CONSTRAINT "ProofOfDelivery_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfDelivery" ADD CONSTRAINT "ProofOfDelivery_tripStopId_fkey" FOREIGN KEY ("tripStopId") REFERENCES "TripStop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProofOfDelivery" ADD CONSTRAINT "ProofOfDelivery_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

