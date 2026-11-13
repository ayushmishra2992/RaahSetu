-- Location search: optional address parts and coordinate provenance.
-- Additive only: existing rows keep their data; new columns are NULL and
-- coordsSource defaults to MANUAL (how every existing location was entered).

-- CreateEnum
CREATE TYPE "CoordSource" AS ENUM ('MANUAL', 'SEARCH', 'PIN_ADJUSTED');

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "city" TEXT,
ADD COLUMN     "coordsSource" "CoordSource" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "country" TEXT,
ADD COLUMN     "placeProvider" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "providerPlaceId" TEXT,
ADD COLUMN     "state" TEXT;
