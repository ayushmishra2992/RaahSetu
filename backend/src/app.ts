import cookieParser from "cookie-parser";
import cors from "cors";
import express, { Router } from "express";
import helmet from "helmet";
import { env } from "./config/env";
import { storageStatus } from "./lib/storage";
import { prisma } from "./config/prisma";
import { authenticate } from "./middleware/auth";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { attachmentRoutes, signedFileRoutes } from "./modules/attachments/attachments.routes";
import auditRoutes from "./modules/audit/audit.routes";
import authRoutes from "./modules/auth/auth.routes";
import billingRoutes from "./modules/billing/billing.routes";
import companyRoutes from "./modules/company/company.routes";
import complianceRoutes from "./modules/compliance/compliance.routes";
import controlTowerRoutes from "./modules/controlTower/controlTower.routes";
import documentRoutes from "./modules/documents/documents.routes";
import driverRoutes from "./modules/drivers/drivers.routes";
import fuelRoutes from "./modules/fuel/fuel.routes";
import greenfleetRoutes from "./modules/greenfleet/greenfleet.routes";
import locationRoutes from "./modules/locations/locations.routes";
import optirouteRoutes from "./modules/optiroute/optiroute.routes";
import orderRoutes from "./modules/orders/orders.routes";
import { createPlacesRouter } from "./modules/places/places.routes";
import roadNetworkRoutes from "./modules/roadNetwork/roadNetwork.routes";
import scenarioRoutes from "./modules/scenarios/scenarios.routes";
import ewayBillRoutes from "./modules/shipments/ewayBills.routes";
import lorryReceiptRoutes from "./modules/shipments/lorryReceipts.routes";
import podRoutes from "./modules/shipments/pods.routes";
import tripDocumentRoutes from "./modules/shipments/tripDocuments.routes";
import tripRoutes from "./modules/trips/trips.routes";
import userRoutes from "./modules/users/users.routes";
import vehicleRoutes from "./modules/vehicles/vehicles.routes";
import verifyRoutes from "./modules/verify/verify.routes";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: "1mb" }));
  app.use(cookieParser());

  app.get("/api/health", async (_req, res) => {
    let database = "ok";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      database = "unreachable";
    }
    res.status(database === "ok" ? 200 : 503).json({ status: database === "ok" ? "ok" : "degraded", database, storage: storageStatus(), service: "raahsetu-api", time: new Date().toISOString() });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/public/verify", verifyRoutes);
  // Short-lived signed document links (HMAC token in the URL; no session needed).
  app.use("/api/files", signedFileRoutes);

  const api = Router();
  api.use(authenticate);
  api.use("/company", companyRoutes);
  api.use("/users", userRoutes);
  api.use("/vehicles", vehicleRoutes);
  api.use("/drivers", driverRoutes);
  api.use("/documents", documentRoutes);
  api.use("/locations", locationRoutes);
  api.use("/places", createPlacesRouter());
  api.use("/road-network", roadNetworkRoutes);
  api.use("/orders", orderRoutes);
  api.use("/trips/:id/documents", tripDocumentRoutes);
  api.use("/trips", tripRoutes);
  api.use("/optiroute", optirouteRoutes);
  api.use("/scenarios", scenarioRoutes);
  api.use("/billing", billingRoutes);
  api.use("/fuel-records", fuelRoutes);
  api.use("/greenfleet", greenfleetRoutes);
  api.use("/control-tower", controlTowerRoutes);
  api.use("/audit", auditRoutes);
  api.use("/compliance", complianceRoutes);
  api.use("/attachments", attachmentRoutes);
  api.use("/eway-bills", ewayBillRoutes);
  api.use("/lorry-receipts", lorryReceiptRoutes);
  api.use("/pods", podRoutes);
  app.use("/api", api);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
