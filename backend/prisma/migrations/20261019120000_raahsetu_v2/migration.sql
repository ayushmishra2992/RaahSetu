-- RaahSetu 2.0: fleet, compliance, geography, orders/trips, OptiRoute, scenarios, billing, GreenFleet, audit.

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'DISPATCHER';

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('TRUCK', 'MINI_TRUCK', 'VAN', 'PICKUP', 'TRAILER', 'TANKER');

-- CreateEnum
CREATE TYPE "FuelType" AS ENUM ('DIESEL', 'PETROL', 'CNG', 'ELECTRIC');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('AVAILABLE', 'ON_TRIP', 'MAINTENANCE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DriverStatus" AS ENUM ('AVAILABLE', 'ON_TRIP', 'OFF_DUTY', 'INACTIVE');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('RC', 'INSURANCE', 'PUC', 'FITNESS', 'PERMIT', 'DRIVING_LICENSE', 'OTHER');

-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('DEPOT', 'WAREHOUSE', 'CUSTOMER', 'OTHER');

-- CreateEnum
CREATE TYPE "OrderPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'ASSIGNED', 'IN_TRANSIT', 'DELIVERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNED', 'DISPATCHED', 'IN_TRANSIT', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StopType" AS ENUM ('DEPOT_START', 'PICKUP', 'DROP', 'DEPOT_END');

-- CreateEnum
CREATE TYPE "StopStatus" AS ENUM ('PENDING', 'ARRIVED', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "OptimizationAlgorithm" AS ENUM ('GREEDY_INSERTION', 'LOCAL_SEARCH', 'SIMULATED_ANNEALING');

-- CreateEnum
CREATE TYPE "OptimizationStatus" AS ENUM ('COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ScenarioType" AS ENUM ('VEHICLE_BREAKDOWN', 'ROAD_CLOSURE', 'URGENT_ORDER', 'DRIVER_UNAVAILABLE');

-- CreateEnum
CREATE TYPE "ScenarioStatus" AS ENUM ('EVALUATED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "BillingDocumentKind" AS ENUM ('INVOICE', 'DELIVERY_CHALLAN');

-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'CANCELLED');

-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "address" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "settings" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "state" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "lastLoginAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Vehicle" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "capacityKg" INTEGER NOT NULL,
    "fuelType" "FuelType" NOT NULL DEFAULT 'DIESEL',
    "mileageKmPerUnit" DOUBLE PRECISION NOT NULL,
    "avgSpeedKmph" DOUBLE PRECISION NOT NULL DEFAULT 40,
    "status" "VehicleStatus" NOT NULL DEFAULT 'AVAILABLE',
    "odometerKm" INTEGER NOT NULL DEFAULT 0,
    "depotLocationId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Driver" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "licenseExpiry" TIMESTAMP(3) NOT NULL,
    "status" "DriverStatus" NOT NULL DEFAULT 'AVAILABLE',
    "maxShiftHours" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceDocument" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "type" "DocumentType" NOT NULL,
    "documentNumber" TEXT NOT NULL,
    "issuedOn" TIMESTAMP(3),
    "expiresOn" TIMESTAMP(3),
    "notes" TEXT,
    "vehicleId" INTEGER,
    "driverId" INTEGER,
    "fileName" TEXT,
    "fileMimeType" TEXT,
    "fileSizeBytes" INTEGER,
    "storageKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "type" "LocationType" NOT NULL DEFAULT 'CUSTOMER',
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "roadNodeId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoadNode" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "RoadNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoadEdge" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "fromNodeId" INTEGER NOT NULL,
    "toNodeId" INTEGER NOT NULL,
    "distanceKm" DOUBLE PRECISION NOT NULL,
    "speedKmph" DOUBLE PRECISION NOT NULL DEFAULT 45,
    "bidirectional" BOOLEAN NOT NULL DEFAULT true,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,

    CONSTRAINT "RoadEdge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "pickupLocationId" INTEGER NOT NULL,
    "dropLocationId" INTEGER NOT NULL,
    "weightKg" INTEGER NOT NULL,
    "priority" "OrderPriority" NOT NULL DEFAULT 'NORMAL',
    "readyAt" TIMESTAMP(3),
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    "serviceMinutes" INTEGER NOT NULL DEFAULT 20,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "declaredValue" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "tripNumber" TEXT NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "driverId" INTEGER NOT NULL,
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "plannedStart" TIMESTAMP(3) NOT NULL,
    "plannedEnd" TIMESTAMP(3),
    "actualStart" TIMESTAMP(3),
    "actualEnd" TIMESTAMP(3),
    "plannedDistanceKm" DOUBLE PRECISION,
    "estFuelUnits" DOUBLE PRECISION,
    "estCost" DOUBLE PRECISION,
    "estCo2Kg" DOUBLE PRECISION,
    "optimizationRunId" INTEGER,
    "verificationToken" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripStop" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "StopType" NOT NULL,
    "locationId" INTEGER NOT NULL,
    "orderId" INTEGER,
    "plannedArrival" TIMESTAMP(3),
    "actualArrival" TIMESTAMP(3),
    "status" "StopStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "TripStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripEvent" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER NOT NULL,
    "fromStatus" "TripStatus",
    "toStatus" "TripStatus" NOT NULL,
    "note" TEXT,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptimizationRun" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "createdById" INTEGER,
    "name" TEXT,
    "algorithm" "OptimizationAlgorithm" NOT NULL,
    "status" "OptimizationStatus" NOT NULL,
    "seed" INTEGER NOT NULL,
    "request" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "objective" DOUBLE PRECISION,
    "feasible" BOOLEAN NOT NULL,
    "totalDistanceKm" DOUBLE PRECISION,
    "totalCo2Kg" DOUBLE PRECISION,
    "totalCost" DOUBLE PRECISION,
    "unservedCount" INTEGER NOT NULL DEFAULT 0,
    "runtimeMs" INTEGER NOT NULL,
    "distanceSource" TEXT NOT NULL,
    "dispatchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OptimizationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ScenarioType" NOT NULL,
    "params" JSONB NOT NULL,
    "status" "ScenarioStatus" NOT NULL DEFAULT 'EVALUATED',
    "baseRunId" INTEGER NOT NULL,
    "resultRunId" INTEGER,
    "comparison" JSONB,
    "createdById" INTEGER,
    "decidedById" INTEGER,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingDocument" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "kind" "BillingDocumentKind" NOT NULL DEFAULT 'INVOICE',
    "number" TEXT NOT NULL,
    "status" "BillingStatus" NOT NULL DEFAULT 'DRAFT',
    "tripId" INTEGER,
    "customerName" TEXT NOT NULL,
    "customerGstin" TEXT,
    "customerAddress" TEXT,
    "taxRatePercent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "issuedAt" TIMESTAMP(3),
    "dueDate" TIMESTAMP(3),
    "notes" TEXT,
    "verificationToken" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillingDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingItem" (
    "id" SERIAL NOT NULL,
    "documentId" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'nos',
    "rate" DOUBLE PRECISION NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "BillingItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelRecord" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "vehicleId" INTEGER NOT NULL,
    "filledAt" TIMESTAMP(3) NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "totalCost" DOUBLE PRECISION NOT NULL,
    "odometerKm" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" SERIAL NOT NULL,
    "companyId" INTEGER NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" INTEGER,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "User_companyId_idx" ON "User"("companyId");

-- CreateIndex
CREATE INDEX "Vehicle_companyId_status_idx" ON "Vehicle"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Vehicle_companyId_registrationNumber_key" ON "Vehicle"("companyId", "registrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_userId_key" ON "Driver"("userId");

-- CreateIndex
CREATE INDEX "Driver_companyId_status_idx" ON "Driver"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_companyId_licenseNumber_key" ON "Driver"("companyId", "licenseNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ComplianceDocument_storageKey_key" ON "ComplianceDocument"("storageKey");

-- CreateIndex
CREATE INDEX "ComplianceDocument_companyId_expiresOn_idx" ON "ComplianceDocument"("companyId", "expiresOn");

-- CreateIndex
CREATE INDEX "Location_companyId_idx" ON "Location"("companyId");

-- CreateIndex
CREATE INDEX "RoadNode_companyId_idx" ON "RoadNode"("companyId");

-- CreateIndex
CREATE INDEX "RoadEdge_companyId_idx" ON "RoadEdge"("companyId");

-- CreateIndex
CREATE INDEX "Order_companyId_status_idx" ON "Order"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Order_companyId_orderNumber_key" ON "Order"("companyId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_verificationToken_key" ON "Trip"("verificationToken");

-- CreateIndex
CREATE INDEX "Trip_companyId_status_idx" ON "Trip"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_companyId_tripNumber_key" ON "Trip"("companyId", "tripNumber");

-- CreateIndex
CREATE UNIQUE INDEX "TripStop_tripId_sequence_key" ON "TripStop"("tripId", "sequence");

-- CreateIndex
CREATE INDEX "TripEvent_tripId_idx" ON "TripEvent"("tripId");

-- CreateIndex
CREATE INDEX "OptimizationRun_companyId_createdAt_idx" ON "OptimizationRun"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "Scenario_companyId_idx" ON "Scenario"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "BillingDocument_verificationToken_key" ON "BillingDocument"("verificationToken");

-- CreateIndex
CREATE INDEX "BillingDocument_companyId_status_idx" ON "BillingDocument"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BillingDocument_companyId_kind_number_key" ON "BillingDocument"("companyId", "kind", "number");

-- CreateIndex
CREATE INDEX "FuelRecord_companyId_vehicleId_filledAt_idx" ON "FuelRecord"("companyId", "vehicleId", "filledAt");

-- CreateIndex
CREATE INDEX "AuditEvent_companyId_createdAt_idx" ON "AuditEvent"("companyId", "createdAt");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_depotLocationId_fkey" FOREIGN KEY ("depotLocationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplianceDocument" ADD CONSTRAINT "ComplianceDocument_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_roadNodeId_fkey" FOREIGN KEY ("roadNodeId") REFERENCES "RoadNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadNode" ADD CONSTRAINT "RoadNode_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadEdge" ADD CONSTRAINT "RoadEdge_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadEdge" ADD CONSTRAINT "RoadEdge_fromNodeId_fkey" FOREIGN KEY ("fromNodeId") REFERENCES "RoadNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoadEdge" ADD CONSTRAINT "RoadEdge_toNodeId_fkey" FOREIGN KEY ("toNodeId") REFERENCES "RoadNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_pickupLocationId_fkey" FOREIGN KEY ("pickupLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_dropLocationId_fkey" FOREIGN KEY ("dropLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_optimizationRunId_fkey" FOREIGN KEY ("optimizationRunId") REFERENCES "OptimizationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripStop" ADD CONSTRAINT "TripStop_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripStop" ADD CONSTRAINT "TripStop_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripStop" ADD CONSTRAINT "TripStop_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripEvent" ADD CONSTRAINT "TripEvent_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptimizationRun" ADD CONSTRAINT "OptimizationRun_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_baseRunId_fkey" FOREIGN KEY ("baseRunId") REFERENCES "OptimizationRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_resultRunId_fkey" FOREIGN KEY ("resultRunId") REFERENCES "OptimizationRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingDocument" ADD CONSTRAINT "BillingDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingDocument" ADD CONSTRAINT "BillingDocument_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingItem" ADD CONSTRAINT "BillingItem_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "BillingDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelRecord" ADD CONSTRAINT "FuelRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FuelRecord" ADD CONSTRAINT "FuelRecord_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
