/**
 * DEVELOPMENT-ONLY demo data. Idempotent: it deletes and recreates the two demo
 * companies (identified by their demo GSTINs) and nothing else.
 *
 * All demo users share the password printed at the end. Never run this
 * against a production database.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/client";
import { estimateTrip, DEFAULT_COST_MODEL } from "../src/optimizer/costModel";
import { haversineKm } from "../src/optimizer/geo";

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed demo data with NODE_ENV=production");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Copy backend/.env.example to backend/.env first.");
  process.exit(1);
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const DEMO_PASSWORD = "Demo@1234";
const DEMO_GSTIN = "27DEMO0000A1Z5";
const OTHER_GSTIN = "29DEMO0000B1Z3";
const token = () => randomBytes(18).toString("base64url");
const day = 86_400_000;

/** Tomorrow at the given IST hour, as a UTC Date. */
function tomorrowIst(hour: number, minute = 0) {
  const now = new Date();
  const istNow = new Date(now.getTime() + 330 * 60000);
  const d = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate() + 1, hour, minute) - 330 * 60000;
  return new Date(d);
}

// Synthetic road network: real place names and approximate coordinates in the
// Mumbai–Pune–Nashik region; edge lengths are straight-line × 1.25 (SYNTHETIC).
const NODES = [
  { key: "BHW", name: "Bhiwandi Junction", lat: 19.2967, lng: 73.0631 },
  { key: "THN", name: "Thane", lat: 19.2183, lng: 72.9781 },
  { key: "AIR", name: "Andheri", lat: 19.1136, lng: 72.8697 },
  { key: "DDR", name: "Dadar", lat: 19.0178, lng: 72.8478 },
  { key: "VSH", name: "Vashi", lat: 19.0771, lng: 72.9986 },
  { key: "PNV", name: "Panvel", lat: 18.9894, lng: 73.1175 },
  { key: "KHP", name: "Khopoli", lat: 18.7856, lng: 73.3459 },
  { key: "LNV", name: "Lonavala", lat: 18.7546, lng: 73.4062 },
  { key: "TLG", name: "Talegaon", lat: 18.7357, lng: 73.6756 },
  { key: "CHK", name: "Chakan", lat: 18.7606, lng: 73.8636 },
  { key: "PUN", name: "Pune (Shivajinagar)", lat: 18.5308, lng: 73.8475 },
  { key: "HDP", name: "Hadapsar", lat: 18.5089, lng: 73.926 },
  { key: "KLY", name: "Kalyan", lat: 19.2403, lng: 73.1305 },
  { key: "IGT", name: "Igatpuri", lat: 19.6956, lng: 73.5631 },
  { key: "NSK", name: "Nashik", lat: 19.9975, lng: 73.7898 },
  { key: "SNN", name: "Sinnar MIDC", lat: 19.8456, lng: 74.0 },
];
const EDGES: Array<[string, string, number, string]> = [
  ["BHW", "THN", 45, "Mumbai–Nashik Hwy (Thane spur)"],
  ["THN", "AIR", 35, "Eastern Express / JVLR"],
  ["AIR", "DDR", 30, "Western Express Hwy"],
  ["THN", "VSH", 40, "Thane–Belapur Rd"],
  ["DDR", "VSH", 35, "Sion–Panvel Hwy"],
  ["VSH", "PNV", 50, "Sion–Panvel Hwy (east)"],
  ["PNV", "KHP", 60, "Mumbai–Pune Expressway (ghat start)"],
  ["KHP", "LNV", 40, "Bhor Ghat"],
  ["LNV", "TLG", 60, "Old Mumbai–Pune Hwy"],
  ["TLG", "CHK", 50, "Talegaon–Chakan Rd"],
  ["TLG", "PUN", 55, "Old Mumbai–Pune Hwy (Pune)"],
  ["CHK", "PUN", 40, "Pune–Nashik Hwy (south)"],
  ["PUN", "HDP", 35, "Solapur Rd"],
  ["BHW", "KLY", 40, "Bhiwandi–Kalyan Rd"],
  ["KLY", "PNV", 45, "Kalyan–Shil Rd"],
  ["BHW", "IGT", 60, "Mumbai–Nashik Hwy (Kasara ghat)"],
  ["IGT", "NSK", 65, "Mumbai–Nashik Hwy"],
  ["NSK", "SNN", 55, "Nashik–Sinnar Rd"],
  ["SNN", "CHK", 60, "Pune–Nashik Hwy"],
];

async function wipe(gstin: string) {
  const c = await prisma.company.findUnique({ where: { gstNumber: gstin } });
  if (!c) return;
  // Delete children that use RESTRICT relations first, then the company cascades.
  await prisma.billingDocument.deleteMany({ where: { companyId: c.id } });
  await prisma.trip.deleteMany({ where: { companyId: c.id } });
  await prisma.scenario.deleteMany({ where: { companyId: c.id } });
  await prisma.optimizationRun.deleteMany({ where: { companyId: c.id } });
  await prisma.order.deleteMany({ where: { companyId: c.id } });
  await prisma.company.delete({ where: { id: c.id } });
}

async function main() {
  await wipe(DEMO_GSTIN);
  await wipe(OTHER_GSTIN);
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const demoEmails = ["admin", "manager", "dispatcher", "viewer", "driver", "driver2"].map((r) => `${r}@demo.raahsetu.local`);
  await prisma.user.deleteMany({ where: { email: { in: [...demoEmails, "admin@other.raahsetu.local"] } } });

  const company = await prisma.company.create({
    data: {
      name: "Setu Logistics (Demo)",
      gstNumber: DEMO_GSTIN,
      address: "Plot 12, Logistics Park",
      city: "Bhiwandi",
      state: "Maharashtra",
      phone: "+91 22 0000 0000",
      settings: {},
    },
  });
  const cid = company.id;

  const mkUser = (email: string, name: string, role: "ADMIN" | "MANAGER" | "DISPATCHER" | "EMPLOYEE" | "DRIVER") =>
    prisma.user.create({ data: { email, name, role, passwordHash, companyId: cid } });
  const admin = await mkUser("admin@demo.raahsetu.local", "Asha Admin", "ADMIN");
  await mkUser("manager@demo.raahsetu.local", "Manoj Manager", "MANAGER");
  await mkUser("dispatcher@demo.raahsetu.local", "Divya Dispatcher", "DISPATCHER");
  await mkUser("viewer@demo.raahsetu.local", "Vikram Viewer", "EMPLOYEE");
  const driverUser = await mkUser("driver@demo.raahsetu.local", "Ravi Kumar", "DRIVER");
  const driverUser2 = await mkUser("driver2@demo.raahsetu.local", "Sunil Patil", "DRIVER");

  // Road network
  const nodeIds: Record<string, number> = {};
  for (const n of NODES) nodeIds[n.key] = (await prisma.roadNode.create({ data: { companyId: cid, name: n.name, lat: n.lat, lng: n.lng } })).id;
  for (const [a, b, speed, name] of EDGES) {
    const na = NODES.find((n) => n.key === a)!;
    const nb = NODES.find((n) => n.key === b)!;
    await prisma.roadEdge.create({
      data: { companyId: cid, fromNodeId: nodeIds[a], toNodeId: nodeIds[b], distanceKm: Math.round(haversineKm(na, nb) * 1.25 * 10) / 10, speedKmph: speed, name },
    });
  }

  // Locations
  const L = async (name: string, type: "DEPOT" | "WAREHOUSE" | "CUSTOMER", lat: number, lng: number, node: string, address?: string) =>
    (await prisma.location.create({ data: { companyId: cid, name, type, lat, lng, roadNodeId: nodeIds[node], address } })).id;
  const depot = await L("Bhiwandi Main Depot", "DEPOT", 19.3002, 73.0588, "BHW", "Logistics Park, Bhiwandi");
  const punedepot = await L("Chakan Satellite Depot", "DEPOT", 18.7632, 73.8612, "CHK", "MIDC Chakan");
  const whVashi = await L("Vashi APMC Warehouse", "WAREHOUSE", 19.0794, 73.0101, "VSH");
  const whTaloja = await L("Panvel Cold Store", "WAREHOUSE", 18.9935, 73.1201, "PNV");
  const cAndheri = await L("Andheri Retail Hub", "CUSTOMER", 19.119, 72.8467, "AIR");
  const cDadar = await L("Dadar Wholesale Market", "CUSTOMER", 19.0186, 72.8424, "DDR");
  const cThane = await L("Thane Supermart DC", "CUSTOMER", 19.2052, 72.9752, "THN");
  const cKalyan = await L("Kalyan Pharma Distributor", "CUSTOMER", 19.2437, 73.1355, "KLY");
  const cLonavala = await L("Lonavala Resort Supplies", "CUSTOMER", 18.7537, 73.4066, "LNV");
  const cPune = await L("Pune Electronics Mart", "CUSTOMER", 18.5286, 73.8446, "PUN");
  const cHadapsar = await L("Hadapsar Auto Parts", "CUSTOMER", 18.5034, 73.9332, "HDP");
  const cNashik = await L("Nashik Agro Traders", "CUSTOMER", 19.9933, 73.7983, "NSK");
  const cSinnar = await L("Sinnar Engineering Works", "CUSTOMER", 19.8501, 74.0002, "SNN");
  const cTalegaon = await L("Talegaon Auto Plant", "CUSTOMER", 18.7349, 73.6764, "TLG");

  // Vehicles
  const V = (data: { reg: string; type: "TRUCK" | "MINI_TRUCK" | "VAN" | "PICKUP"; make: string; model: string; year: number; cap: number; fuel: "DIESEL" | "CNG" | "ELECTRIC"; mileage: number; speed: number; depot: number; status?: "AVAILABLE" | "MAINTENANCE"; odo: number }) =>
    prisma.vehicle.create({
      data: {
        companyId: cid,
        registrationNumber: data.reg,
        type: data.type,
        make: data.make,
        model: data.model,
        year: data.year,
        capacityKg: data.cap,
        fuelType: data.fuel,
        mileageKmPerUnit: data.mileage,
        avgSpeedKmph: data.speed,
        depotLocationId: data.depot,
        status: data.status ?? "AVAILABLE",
        odometerKm: data.odo,
      },
    });
  const v1 = await V({ reg: "MH04AB1234", type: "TRUCK", make: "Tata", model: "LPT 1613", year: 2019, cap: 9000, fuel: "DIESEL", mileage: 5.5, speed: 42, depot, odo: 182400 });
  const v2 = await V({ reg: "MH04CD5678", type: "MINI_TRUCK", make: "Ashok Leyland", model: "Dost+", year: 2022, cap: 1500, fuel: "DIESEL", mileage: 14, speed: 45, depot, odo: 64200 });
  const v3 = await V({ reg: "MH12EF9012", type: "TRUCK", make: "Eicher", model: "Pro 2110", year: 2021, cap: 5000, fuel: "DIESEL", mileage: 8, speed: 45, depot: punedepot, odo: 98100 });
  const v4 = await V({ reg: "MH04GH3456", type: "VAN", make: "Tata", model: "Ace EV", year: 2023, cap: 750, fuel: "ELECTRIC", mileage: 6.5, speed: 40, depot, odo: 21800 });
  const v5 = await V({ reg: "MH43JK7890", type: "PICKUP", make: "Mahindra", model: "Bolero Pik-Up CNG", year: 2020, cap: 1700, fuel: "CNG", mileage: 13, speed: 45, depot, odo: 120500 });
  const v6 = await V({ reg: "MH15LM2468", type: "TRUCK", make: "BharatBenz", model: "1617R", year: 2016, cap: 10000, fuel: "DIESEL", mileage: 5, speed: 40, depot, status: "MAINTENANCE", odo: 341000 });

  // Drivers
  const D = (name: string, phone: string, lic: string, expiryDays: number, userId?: number, status: "AVAILABLE" | "OFF_DUTY" = "AVAILABLE") =>
    prisma.driver.create({ data: { companyId: cid, name, phone, licenseNumber: lic, licenseExpiry: new Date(Date.now() + expiryDays * day), userId, status, maxShiftHours: 10 } });
  const d1 = await D("Ravi Kumar", "+91 98200 00001", "MH0420190001234", 900, driverUser.id);
  const d2 = await D("Sunil Patil", "+91 98200 00002", "MH1220180005678", 400, driverUser2.id);
  const d3 = await D("Imran Shaikh", "+91 98200 00003", "MH0420200009012", 20);
  const d4 = await D("Prakash Jadhav", "+91 98200 00004", "MH4320170003456", 700);
  await D("Anil More", "+91 98200 00005", "MH1520160007890", 300, undefined, "OFF_DUTY");

  // Compliance documents (one expired PUC on v5 so planners see an exclusion)
  const doc = (type: "RC" | "INSURANCE" | "PUC" | "FITNESS" | "PERMIT" | "DRIVING_LICENSE", number: string, expiresInDays: number | null, owner: { vehicleId?: number; driverId?: number }) =>
    prisma.complianceDocument.create({
      data: { companyId: cid, type, documentNumber: number, issuedOn: new Date(Date.now() - 300 * day), expiresOn: expiresInDays === null ? null : new Date(Date.now() + expiresInDays * day), ...owner },
    });
  for (const v of [v1, v2, v3, v4, v5, v6]) {
    await doc("RC", `RC-${v.registrationNumber}`, null, { vehicleId: v.id });
    await doc("INSURANCE", `INS-${v.registrationNumber}`, v.id === v2.id ? 18 : 200, { vehicleId: v.id });
    await doc("PUC", `PUC-${v.registrationNumber}`, v.id === v5.id ? -5 : 120, { vehicleId: v.id });
  }
  await doc("FITNESS", `FIT-${v1.registrationNumber}`, 250, { vehicleId: v1.id });
  await doc("PERMIT", `NP-${v3.registrationNumber}`, 25, { vehicleId: v3.id });
  await doc("DRIVING_LICENSE", "MH0420200009012", 20, { driverId: d3.id });

  // Pending orders for tomorrow (IST windows)
  let n = 1;
  const O = (customer: string, from: number, to: number, kg: number, priority: "LOW" | "NORMAL" | "HIGH" | "URGENT", ws: number | null, we: number | null) =>
    prisma.order.create({
      data: {
        companyId: cid,
        orderNumber: `ORD-DEMO-${String(n++).padStart(3, "0")}`,
        customerName: customer,
        pickupLocationId: from,
        dropLocationId: to,
        weightKg: kg,
        priority,
        windowStart: ws === null ? null : tomorrowIst(ws),
        windowEnd: we === null ? null : tomorrowIst(we),
        serviceMinutes: 20,
        declaredValue: kg * 120,
      },
    });
  await O("Andheri Retail Hub", whVashi, cAndheri, 1200, "HIGH", 9, 14);
  await O("Dadar Wholesale Market", whVashi, cDadar, 2500, "NORMAL", 9, 16);
  await O("Thane Supermart DC", whTaloja, cThane, 900, "NORMAL", 10, 17);
  await O("Kalyan Pharma Distributor", whTaloja, cKalyan, 300, "URGENT", 8, 12);
  await O("Lonavala Resort Supplies", whTaloja, cLonavala, 600, "NORMAL", 11, 18);
  await O("Pune Electronics Mart", depot, cPune, 3200, "HIGH", 12, 19);
  await O("Hadapsar Auto Parts", punedepot, cHadapsar, 1400, "NORMAL", 9, 15);
  await O("Talegaon Auto Plant", punedepot, cTalegaon, 2600, "HIGH", 9, 14);
  await O("Nashik Agro Traders", depot, cNashik, 4000, "NORMAL", 10, 19);
  await O("Sinnar Engineering Works", depot, cSinnar, 1800, "LOW", null, null);
  await O("Andheri Retail Hub", depot, cAndheri, 450, "LOW", null, null);
  await O("Thane Supermart DC", whVashi, cThane, 700, "NORMAL", 13, 18);

  // History: completed trips with estimates, fuel logs and billing (clearly demo data)
  const hist = async (vehicle: typeof v1, driverId: number, from: number, to: number, km: number, daysAgo: number, kg: number, customer: string) => {
    const start = new Date(Date.now() - daysAgo * day);
    const durationMin = (km / vehicle.avgSpeedKmph) * 60 + 40;
    const est = estimateTrip({ distanceKm: km, durationMin, averageLoadKg: kg / 2, capacityKg: vehicle.capacityKg, fuelType: vehicle.fuelType, mileageKmPerUnit: vehicle.mileageKmPerUnit }, DEFAULT_COST_MODEL);
    const order = await prisma.order.create({
      data: { companyId: cid, orderNumber: `ORD-DEMO-H${daysAgo}`, customerName: customer, pickupLocationId: from, dropLocationId: to, weightKg: kg, status: "DELIVERED", windowEnd: new Date(start.getTime() + 8 * 3600000) },
    });
    const end = new Date(start.getTime() + durationMin * 60000);
    return prisma.trip.create({
      data: {
        companyId: cid,
        tripNumber: `TRP-DEMO-H${daysAgo}`,
        vehicleId: vehicle.id,
        driverId,
        status: "COMPLETED",
        plannedStart: start,
        plannedEnd: end,
        actualStart: start,
        actualEnd: end,
        plannedDistanceKm: km,
        estFuelUnits: Math.round(est.fuelUnits * 100) / 100,
        estCost: Math.round(est.operatingCost),
        estCo2Kg: Math.round(est.co2Kg * 10) / 10,
        verificationToken: token(),
        stops: {
          create: [
            { sequence: 0, type: "DEPOT_START", locationId: vehicle.depotLocationId!, plannedArrival: start, actualArrival: start, status: "COMPLETED" },
            { sequence: 1, type: "PICKUP", locationId: from, orderId: order.id, plannedArrival: new Date(start.getTime() + 30 * 60000), actualArrival: new Date(start.getTime() + 35 * 60000), status: "COMPLETED" },
            { sequence: 2, type: "DROP", locationId: to, orderId: order.id, plannedArrival: new Date(end.getTime() - 30 * 60000), actualArrival: new Date(end.getTime() - 25 * 60000), status: "COMPLETED" },
            { sequence: 3, type: "DEPOT_END", locationId: vehicle.depotLocationId!, plannedArrival: end, actualArrival: end, status: "COMPLETED" },
          ],
        },
        events: {
          create: [
            { toStatus: "PLANNED", note: "Demo history", userId: admin.id, createdAt: new Date(start.getTime() - 3600000) },
            { fromStatus: "PLANNED", toStatus: "DISPATCHED", userId: admin.id, createdAt: new Date(start.getTime() - 1800000) },
            { fromStatus: "DISPATCHED", toStatus: "IN_TRANSIT", userId: driverUser.id, createdAt: start },
            { fromStatus: "IN_TRANSIT", toStatus: "COMPLETED", userId: driverUser.id, createdAt: end },
          ],
        },
      },
    });
  };
  const t1 = await hist(v1, d1.id, depot, cNashik, 196, 6, 6000, "Nashik Agro Traders");
  await hist(v3, d2.id, punedepot, cHadapsar, 42, 4, 3500, "Hadapsar Auto Parts");
  await hist(v2, d4.id, whVashi, cAndheri, 38, 2, 1100, "Andheri Retail Hub");

  const fuel = (vehicleId: number, daysAgo: number, qty: number, price: number, odo: number) =>
    prisma.fuelRecord.create({ data: { companyId: cid, vehicleId, filledAt: new Date(Date.now() - daysAgo * day), quantity: qty, totalCost: Math.round(qty * price), odometerKm: odo } });
  await fuel(v1.id, 20, 180, 90, 181200);
  await fuel(v1.id, 10, 120, 91, 181850);
  await fuel(v1.id, 3, 150, 90, 182400);
  await fuel(v2.id, 15, 35, 90, 63700);
  await fuel(v2.id, 5, 38, 90, 64200);

  await prisma.billingDocument.create({
    data: {
      companyId: cid,
      kind: "INVOICE",
      number: `INV-${new Date().getFullYear()}-0001`,
      status: "ISSUED",
      tripId: t1.id,
      customerName: "Nashik Agro Traders",
      customerGstin: "27AAAAA0000A1Z5",
      customerAddress: "Nashik, Maharashtra",
      taxRatePercent: 18,
      subtotal: 18500,
      taxAmount: 3330,
      total: 21830,
      issuedAt: new Date(Date.now() - 5 * day),
      dueDate: new Date(Date.now() + 25 * day),
      verificationToken: token(),
      notes: "Demo invoice",
      items: { create: [{ description: "Freight Bhiwandi → Nashik (9T truck)", quantity: 1, unit: "trip", rate: 17000, amount: 17000 }, { description: "Loading/unloading", quantity: 2, unit: "hrs", rate: 750, amount: 1500 }] },
    },
  });
  await prisma.billingDocument.create({
    data: {
      companyId: cid,
      kind: "DELIVERY_CHALLAN",
      number: `DC-${new Date().getFullYear()}-0001`,
      status: "DRAFT",
      customerName: "Pune Electronics Mart",
      verificationToken: token(),
      items: { create: [{ description: "Consumer electronics cartons", quantity: 64, unit: "cartons", rate: 0, amount: 0 }] },
    },
  });
  await prisma.auditEvent.create({ data: { companyId: cid, userId: admin.id, action: "demo.seeded", entityType: "Company", entityId: cid } });

  // A second tenant, used to demonstrate (and test) company isolation.
  const other = await prisma.company.create({ data: { name: "Other Transport Co (Demo)", gstNumber: OTHER_GSTIN, city: "Bengaluru", state: "Karnataka" } });
  await prisma.user.create({ data: { email: "admin@other.raahsetu.local", name: "Other Admin", role: "ADMIN", passwordHash, companyId: other.id } });
  const otherDepot = await prisma.location.create({ data: { companyId: other.id, name: "Peenya Depot", type: "DEPOT", lat: 13.0285, lng: 77.5197 } });
  await prisma.vehicle.create({ data: { companyId: other.id, registrationNumber: "KA01ZZ0001", type: "TRUCK", capacityKg: 7000, fuelType: "DIESEL", mileageKmPerUnit: 6, depotLocationId: otherDepot.id } });

  console.log("\nDemo data created (DEVELOPMENT ONLY).");
  console.log(`Password for every demo user: ${DEMO_PASSWORD}`);
  console.log("  admin@demo.raahsetu.local       ADMIN");
  console.log("  manager@demo.raahsetu.local     MANAGER");
  console.log("  dispatcher@demo.raahsetu.local  DISPATCHER");
  console.log("  viewer@demo.raahsetu.local      EMPLOYEE (read-only)");
  console.log("  driver@demo.raahsetu.local      DRIVER (Ravi Kumar)");
  console.log("  admin@other.raahsetu.local      ADMIN of a second company (tenant isolation demo)\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
