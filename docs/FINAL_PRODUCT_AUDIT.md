# RaahSetu — Final Product Audit

**Date:** 19 November 2026
**Branch audited:** `feature/raahsetu-3-final`, created from `fix/nextjs-security-patch` @ `7d0048c`. It contains the transport-documents commit `55fae1a` and the Next.js 16.4.5 patch.

## How this audit was done

The audit is based on the source code. I read the Prisma schema, every Express router, every Next.js page, and the shared components. Each backend endpoint was then matched to the frontend code that calls it.

- A feature is **Complete** only if a user can do it from the UI, end to end.
- If an endpoint exists but no screen calls it, the feature is **Backend only**.
- The browser end-to-end check against real Backblaze B2 storage was set up, but it was paused before login. It is **not** counted as passed here (see "Storage" below).

Classification used:

- **Complete**: a working UI and API for the whole workflow.
- **Partial**: usable, but steps listed in the requirements are missing.
- **Backend only**: an API exists, but no screen uses it.
- **Frontend only**: a screen exists with no API behind it. *None were found.*
- **Missing**: neither an API nor a screen.
- **Investigate**: possibly broken; needs a run-time check.

## Repository and Git state

| Item | State |
|---|---|
| Branches | `main` (`2f8dd8d`, matches `origin/main`), `phase-1-critical-fixes`, `phase-2-design-system`, `feature/transport-documents-compliance` (`55fae1a`), `fix/nextjs-security-patch` (`7d0048c`), `feature/raahsetu-3-final` (new) |
| Unpushed work | `55fae1a` and `7d0048c` exist only locally |
| Untracked files | 13 files restored from OneDrive: `docs/IMPLEMENTATION_REPORT.md` and `docs/screenshots/01–12`. They are left untouched. |
| Migrations | `init`, `raahsetu_v2`, `location_place_details`, `transport_documents_compliance`. The last one is not yet applied to production. |
| Stack | Express 5, Prisma 7 with PostgreSQL, Next.js 16.4.5, React 19, Vitest with Supertest, Playwright |

## Feature status

### A. Authentication, company and users

| Feature | Status | Notes |
|---|---|---|
| Register company and first admin | Complete | `/register` |
| Login, logout and session cookie | Complete | httpOnly cookie, rate-limited |
| Change password | Complete | Settings page |
| Company profile (name, GSTIN, address) | Complete | Settings page; `PATCH /company` |
| Multi-tenant isolation | Complete | Every query is scoped by `companyId`, and integration tests cover it |
| Role-based permissions | Complete | Five roles; the permission map is in `backend/src/lib/permissions.ts` |
| User management | Partial | An admin creates users **with a password**. There are no email invitations and no reset-password-by-email; both would need a mail service. |
| Audit log | Complete | `/audit` page for admins; sensitive actions are logged |

### B. Dashboard (Control Tower)

| Feature | Status | Notes |
|---|---|---|
| Vehicles, drivers, trips and orders by status | Complete | Live counts from the database |
| Compliance expiries and alerts | Complete | KYC detail is hidden from roles without `kyc:read` |
| Recent activity, OptiRoute runs, fuel and CO₂ | Complete | |
| Pending payments and outstanding amounts | Missing | Billing has a status (DRAFT, ISSUED, PAID) but no amounts outstanding or payment records |

### C. Vehicles

| Feature | Status | Notes |
|---|---|---|
| Create, view, edit and delete | Complete | Delete is blocked if the vehicle has trips; setting status to INACTIVE works as deactivation |
| Registration, type, make, year, capacity, fuel, ownership, owner, FASTag | Complete | |
| Model, body type, dimensions | Missing | Not in the schema |
| RC, insurance, PUC, fitness, permits, FASTag documents with expiry | Complete | Compliance documents, files stored privately |
| Vehicle photographs | Partial | Only possible as an "Other" document. There is no photo gallery. |
| Assignment history | Complete | "Recent trips" on the detail page |

### D. Drivers

| Feature | Status | Notes |
|---|---|---|
| Profile, contact, licence number, class, issue and expiry dates, emergency contact | Complete | |
| Licence front and back, driver photo | Complete | Uploaded as compliance documents with FRONT and BACK sides |
| Privacy-first KYC | Complete | Only the ID type and last 4 digits are stored, with consent; full numbers are never stored |
| Availability, trip history, expiry alerts | Complete | |

### E. Orders

| Feature | Status | Notes |
|---|---|---|
| Create, edit, cancel and list | Complete | `/orders` |
| Order detail | Complete *(corrected)* | The Orders page has a detail drawer (`?open=<id>`) with details, trips and editing. The original audit missed it. Since Phase 3a it also lists the order's E-Way Bills, LRs and PODs. |
| Customer, pickup and drop, weight, priority, time window, declared value, notes | Complete | |
| Consignee separate from customer; goods description; dimensions; loading details | Missing | |
| Freight amount, advance, oil money, expenses, payment status | Missing | No financial fields on orders or trips |

### F. Trips and dispatch

| Feature | Status | Notes |
|---|---|---|
| Manual trip creation, OptiRoute dispatch | Complete | |
| Assignment checks (vehicle or driver busy, capacity, compliance blocking) | Complete | |
| Status flow: Dispatch → Start → Complete or Abort, plus stop arrive/complete/skip | Complete | |
| Trip QR verification | Complete | |
| Trip expenses and driver advances | Missing | |

### G. Transport documents

| Feature | Status | Notes |
|---|---|---|
| **E-Way Bill**: record with file | Complete | Trip page → order panel → "Record E-Way Bill" |
| E-Way Bill: full detail view | Missing | Only the number, validity and vehicle are shown |
| E-Way Bill: edit | Backend only | `PATCH /eway-bills/:id` |
| E-Way Bill: add files later | Backend only | `POST /eway-bills/:id/files`. This endpoint also accepts files for a cancelled record. |
| E-Way Bill: cancel | Backend only | No reason is stored |
| E-Way Bill: history | Backend only | Only through the admin audit log |
| **LR / Bilty**: issue with values filled from the order | Complete | |
| LR: PDF download | Complete | |
| LR: detail view, edit, cancel | Backend only | |
| LR: advance, balance, terms, finalization, cancel reason | Missing | |
| **Delivery challan**: create, edit draft, issue, cancel, PDF, print, QR verification, trip link | Complete | `/billing` |
| Proof of delivery: record (signature, photos, quantity, five outcomes), PDF | Complete | |
| POD: resolve a dispute, add photos later | Backend only | |
| Trip document pack (ZIP) | Complete | Filtered by role |
| Central document register | Missing | `/documents` covers vehicle and driver compliance only |

### H. Billing

| Feature | Status | Notes |
|---|---|---|
| Invoices: GST at a single rate, draft → issued → paid or cancelled, PDF, QR | Complete | |
| Payment records (amount, date, method), outstanding balance, customer billing history | Missing | "Mark paid" changes only the status |

### I. Compliance

| Feature | Status | Notes |
|---|---|---|
| Configurable requirements by vehicle type and fuel; exemptions | Complete | Settings → Compliance policy |
| Expiring, expired, missing and unverified states; optional dispatch blocking with reasons | Complete | |
| E-Way Bill value threshold check | Complete | |

### J. OptiRoute, GreenFleet, locations, scenarios

| Feature | Status | Notes |
|---|---|---|
| OptiRoute: three algorithms, capacity and time windows, explanations, run comparison | Complete | |
| GreenFleet: fuel and CO₂ estimates, savings | Complete | `GET /greenfleet/vehicle/:id` has no screen |
| Location search (LocationIQ), map pins, Leaflet route maps | Complete | No live GPS; the UI says this |
| Road network editor, what-if scenarios | Complete | |

### K. Storage and security

| Feature | Status | Notes |
|---|---|---|
| S3-compatible driver: private bucket, tenant-prefixed random keys, short-lived presigned GETs, signed proxy links | Complete | |
| File type and size checks, upload progress, rate limits, cleanup on failure | Complete | |
| B2 dev bucket self-test (`storage:check`) | Passed | Upload, download, matching bytes, 401 when unsigned, cleanup |
| B2 through the real UI (vehicle document) | Not tested | Session paused before login |
| B2 deleted versions | Investigate | B2 may keep hidden versions after a delete. The lifecycle rule still needs your decision. |

## Defects and debt found

1. ✅ **Fixed in Phase 2. E-Way Bill files on cancelled records.** `POST /eway-bills/:id/files` accepted uploads for cancelled E-Way Bills. It now returns 409.
2. ✅ **Fixed in Phase 2. Unrecorded cancel reasons.** Cancelling an E-Way Bill or LR recorded no reason. A reason is now required, and it is stored with the time and user and shown in the history.
3. ✅ **Fixed in Phase 2. LR edits after delivery.** An LR could be edited at any time; there was no finalized state. LRs now go Draft → Final → Cancelled, and edits are refused once an LR is finalized. LRs issued before this release start as drafts (see the release implication in FINAL_IMPLEMENTATION_REPORT.md).
4. ✅ **Fixed in Phase 2. Wrong button label.** The trip page's billing button said "Create invoice" but also creates challans. It now says "Create invoice / challan".
5. ~~**Design-system page.**~~ Checked: this is not a defect. `/design-system` is `page.dev.tsx`, which is served only by the development server; production builds don't include it.
6. **Open. Missing models.** There are no payment, expense or invitation models. These are larger features, listed in the roadmap.

No feature was found to be "frontend only", and no secrets were found in frontend code or logs.

## Master completion checklist (updated 19 November 2026, after Phase 2 and Phase 3a)

Classification:
- **COMPLETE**: works end to end in the UI, and automated tests cover it.
- **PARTIAL**: usable, but parts listed in the brief are missing.
- **MISSING**: not built.
- **NEEDS VERIFICATION**: built and tested with automated tests, but not yet exercised against real infrastructure.

**No area is currently classified BROKEN.**

| Area | Status | Evidence / gap |
|---|---|---|
| Registration, login, logout, cookie session, change password | COMPLETE | Integration tests (auth) and browser tests |
| Tenant isolation, backend RBAC | COMPLETE | Every query is scoped by company. Cross-company 404 and role 403 tests exist for each document module. |
| User management | PARTIAL | Admins create users with a password. No email invitations or password reset (needs a mail provider: paid, needs approval). |
| Company profile and settings, compliance policy, LR terms | COMPLETE | Settings tabs; settings merge tests |
| Audit log | COMPLETE | `/audit` page. Document history for E-Way Bills and LRs. Each POD change is logged with its before/after values. |
| Vehicles: create, edit, delete, status, ownership, FASTag, documents | COMPLETE | |
| Vehicles: model, body type, dimensions, photo gallery | MISSING | Needs a schema change |
| Drivers: profile, licence, privacy-first KYC, documents, history | COMPLETE | KYC redaction integration tests |
| Orders: create, edit, cancel, detail drawer | COMPLETE | |
| Orders: consignee, goods dimensions, freight, advance, payment status | MISSING | Needs a schema change. LRs carry freight, advance and balance per document. |
| Trips: manual and OptiRoute creation, assignment checks, status flow, stop actions, QR | COMPLETE | |
| Trip expenses and driver advances (oil money, tolls) | MISSING | Needs a new model |
| OptiRoute: 3 algorithms, constraints, explanations, compare runs | COMPLETE | Uses no live traffic, and doesn't claim to |
| GreenFleet estimates | COMPLETE | Labelled as estimates. Uses settings factors. |
| Control Tower: counts, live trips, alerts, expiries | COMPLETE | Data comes from the database. Positions are simulated and labelled as such, with no GPS. |
| E-Way Bill: record, view, edit, add files, cancel with reason, history, register | COMPLETE | Edit, cancel and add-files are race-safe. RaahSetu records E-Way Bills only. |
| LR: draft, edit, finalize, cancel; advance and balance; company terms; PDF | COMPLETE | |
| Delivery challan and invoice: draft, issue, paid, cancel, PDF, print, QR | COMPLETE | |
| Invoice payment records, outstanding balances | MISSING | "Mark paid" sets a status only. Needs a payment model. |
| POD: record, five outcomes, signature and photos, PDF | COMPLETE | |
| POD: dispute resolution UI, add photos later | COMPLETE *(Phase 3a)* | Guarded update. Photo uploads are all-or-nothing. |
| Compliance: requirements, expiry and missing states, dispatch blocking | COMPLETE | |
| Notifications | PARTIAL | Control Tower alerts and expiry alerts only. No notification centre and no email or SMS (would need paid services). |
| List pagination | PARTIAL | Pagination happens in the browser. The APIs cap lists at 500 rows (enough for a demo; server-side paging is a later item). |
| Document storage: private bucket, signed links, validation | COMPLETE | Unit and integration tests run on local storage. The B2 dev self-test (`storage:check`) passed. |
| B2 through the real UI | NEEDS VERIFICATION | Needs your manual login in a test browser |
| New screens against a real backend in a browser | NEEDS VERIFICATION | Browser tests use a mocked API, and integration tests cover the real API separately. `raahsetu_dev` is now migrated, so this can be done after the manual login. |
| PDF print layout on paper | NEEDS VERIFICATION | PDF text and structure are tested automatically; the look on paper isn't. |
