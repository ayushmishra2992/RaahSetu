# Transport documents & compliance

How RaahSetu handles vehicle and driver onboarding, document capture, shipment paperwork (E-Way Bill, lorry receipt, delivery challan, invoice), proof of delivery, trip document packs and compliance-aware dispatch.

> **Scope, stated plainly.** RaahSetu **records** documents and checks them against the dates and rules you configure. It does **not** connect to VAHAN, Sarathi, the GST/E-Way Bill portal, insurers or any other government or third-party system, and it does not generate E-Way Bills or e-invoices. QR verification confirms a record exists in RaahSetu only.

## 1. Vehicle onboarding

**Vehicles → Add vehicle** captures:
- registration number and state;
- type, manufacturer, model and manufacturing year;
- capacity and fuel type, plus mileage, depot and status;
- ownership: owned, leased or attached (a market vehicle, with the registered owner's name and phone);
- FASTag ID.

**Vehicle documents** (vehicle page → **Documents → Add**):

| Document | Type code | Expiry | Required by default |
|---|---|---|---|
| Registration certificate | `RC` | usually none | yes |
| Insurance | `INSURANCE` | yes | yes |
| Pollution Under Control | `PUC` | yes | yes — **except battery-electric vehicles** |
| Fitness certificate | `FITNESS` | yes | yes |
| National / goods permit | `PERMIT` | yes | yes |
| State permit | `STATE_PERMIT` | yes | no |
| FASTag | `FASTAG` | optional | no |
| Other | `OTHER` | optional | no |

Every document records:
- its number, issue date and expiry date;
- notes;
- one or more files (front and back for RC and licence cards, up to 5 pages otherwise);
- verification status, upload time and last-updated time.

## 2. Driver onboarding and privacy-first KYC

**Drivers → Add driver** captures:
- name and mobile number;
- licence number, class, issue date and expiry;
- maximum shift and status;
- an optional link to a driver login.

**Licence copies** are a `DRIVING_LICENSE` document with **front** and **back** images. The expiry on the driver record is authoritative: once it passes, the driver cannot be planned or dispatched. If the uploaded copy shows a different expiry, RaahSetu warns about the mismatch.

**KYC** (admins and managers only; driver page → *Personal details & KYC*):
- **What is stored:**
  - the ID type and only the **last 4 characters** of the ID;
  - address and emergency contact;
  - when consent was recorded, and by whom.
- **Full numbers are rejected:** the API refuses a 12-digit Aadhaar number in both the KYC form and KYC document numbers.
- **Masked copies only:** a `KYC_ID` document should be a *masked* Aadhaar (first 8 digits hidden) or another ID.
- **Consent is required:** a consent checkbox must be ticked before anything is saved.
- **Restricted visibility:**
  - Without `kyc:read`, the API strips every KYC field from driver responses and leaves `KYC_ID` documents out of all lists.
  - KYC documents are never included in trip document packs.
- **Audit log:** it records that KYC changed, never the identifiers themselves.
- **Encryption:** KYC fields are not separately encrypted in the database. Only the last 4 digits and contact details are stored, and the whole database should be encrypted at rest by the host (Neon encrypts by default).

## 3. Capturing documents on a phone

The upload dialogs offer two buttons:
- **Take photo** opens the rear camera directly (`<input capture="environment">`).
- **Choose file** opens the gallery or file manager. PDF, JPG, PNG and WEBP are accepted.

Before upload, in the browser:
- **Preview** each page, **rotate** it 90°, or **remove** it.
- Photos are **compressed** to at most 1600 px as JPEG (~200–500 KB). This keeps uploads fast on mobile data, and it drops EXIF metadata, including GPS.
- HEIC photos are refused with instructions (set the camera to *Most compatible*, or use **Take photo**).

During upload, a **progress bar** is shown. If the upload fails, the same files can be **retried** without re-taking the photos, and errors from the server are shown verbatim.

The server checks every file again:
- that its declared type is allowed;
- that its extension matches the type;
- its file signature (magic bytes), so renamed or spoofed files are rejected;
- the size limit (`MAX_UPLOAD_MB`).

**Verification:** admins and managers can **verify** or **reject** a document (rejecting needs a reason). Editing a document's number, type, owner or dates, or adding files to it, sets its verification back to *pending*.

## 4. Shipment documents

All shipment documents hang off an **order** and optionally a **trip**. They are managed from the trip page → **Trip documents**, one panel per delivery.

### E-Way Bill (recorded, not generated)
**Record E-Way Bill** captures what the portal issued:
- the 12-digit number, document date, valid-from and valid-until;
- supplier and recipient, with their GSTINs;
- places of dispatch and delivery;
- goods description, HSN code, quantity and taxable value;
- invoice or challan reference;
- transporter ID, vehicle number and transport document / LR number.

A PDF or photo of the bill can be attached.

Validation:
- **Formats:** 12-digit number, GSTIN structure, HSN of 4, 6 or 8 digits.
- **Dates:** valid-from and valid-until are not before the document date, and valid-until is not before valid-from.
- **One record per number:** the same number cannot be recorded twice.
- **Vehicle check:** a warning appears if the bill's vehicle differs from the trip's vehicle. Update Part-B on the portal and edit the record.

**Managing a recorded E-Way Bill.** Each record has its own page: Transport Documents → E-Way Bills → the number, or the number on the trip panel. From there you can:
- see every recorded field, its files and its history;
- **Edit details**, with `shipments:write`, while the record is active;
- **Add files** later (up to 5 per record) and open any file through a short-lived private link;
- **Cancel record**, which asks for confirmation and a **reason** (at least 3 characters). The time, the user and the reason are stored, and the record and its files are kept.

A cancelled record can't be edited and accepts no new files (409). Cancelling in RaahSetu does **not** cancel the bill on the government portal; do that on the portal yourself.

### Lorry receipt (LR / bilty)
**Issue LR** creates a receipt with a unique number (`LR-YYYYMMDD-XXXXXX`).

It's pre-filled where possible:
- **From the order:** consignor (your company), consignee (the customer), from/to places, actual weight, declared value and delivery instructions.
- **From the trip:** vehicle and driver.

You add the goods description, packages, charged weight, freight, an optional **advance received** and the payment terms (*Paid*, *To pay* or *To be billed*). The **balance** is freight minus advance. An advance needs a freight amount and can't exceed it (400).

**Lifecycle.** Every LR has its own page: Transport Documents → Lorry receipts → the number, or the number on the trip panel.

| State | What you can do |
|---|---|
| **Draft** | Edit every field, then **Finalize**. The PDF is marked "DRAFT" and previews your current terms. |
| **Final** | Locked: edits return 409. Your LR terms at the moment of finalizing are copied onto the LR, so later changes in Settings don't alter it. |
| **Cancelled** | Read-only. Allowed from Draft or Final, with a required reason; the LR number is never reused. |

**PDF.** The LR PDF shows:
- your company details;
- the LR, order and trip numbers, and the status;
- consignor and consignee;
- vehicle, driver and driver licence (from the trip);
- goods;
- freight, advance and balance, and payment terms;
- E-Way Bill numbers;
- three signature areas.

Use **View / print PDF** (opens in a new tab) or **Download PDF**; every PDF download is recorded in the LR's history.

**Terms.** These are set by an admin under Settings → Transport documents. They print as "Terms and conditions set by *your company*". RaahSetu adds no legal declarations of its own, so if the field is empty, no terms are printed.

**Register.** **Transport Documents**, in the sidebar for every role with `shipments:read`, lists E-Way Bills, LRs and PODs across all trips, with search and status filters. Invoices, challans and vehicle/driver documents keep their own registers, which it links to.

### Delivery challan and invoice
These reuse the existing **Billing** module; there is no second invoice system.

- **Fields:** line items carry an **HSN/SAC code**. Challans also carry a **reason for transport**, and both carry **reference documents** (PO, E-Way Bill, LR).
- **PDF download:** `GET /api/billing/:id/pdf` on the billing page.
  - The challan PDF includes the consignor and consignee, vehicle, driver and licence, route, items with HSN, and signature areas.
  - The invoice PDF shows subtotal, GST and total.
- **QR verification:** issued documents carry a QR to `/verify/:token`. Drafts are marked *DRAFT* and carry no QR.

## 5. Proof of delivery (POD)

On the trip page, while the trip is **in transit**, **Record delivery** on a drop stop opens the POD form:

| Outcome | Stop becomes | Order becomes | Required |
|---|---|---|---|
| Delivered in full | completed | delivered | receiver's signature |
| Partially delivered | completed | delivered | signature, delivered quantity (< ordered), shortage or damage |
| Delivered, but disputed | completed | delivered | signature, remarks |
| Delivery failed | skipped | back to *pending* (re-plan) | remarks |
| Returned | skipped | back to *pending* | remarks |

The form also records:
- the receiver's name and phone;
- date and time (not in the future);
- delivered quantity, shortage and damage;
- up to 5 delivery photos;
- the signature, drawn on the phone screen.

The stop moves through the normal trip workflow, so pickup-before-drop and in-transit rules still apply.

**Editing a recorded POD** is enforced on the server:
- **Drivers:** they may correct details (receiver, phone, remarks, photos) on their own trip **while it is in transit only**. They can never change the outcome, and can't touch a **disputed** POD.
- **Office staff** (dispatcher and up): they may correct details and switch between delivered outcomes, and may mark a delivery **disputed**.
- **Resolving a dispute** (changing a disputed POD to another outcome): only **admins and managers** (`pod:resolve`), and remarks explaining the resolution are required.
- **Every edit:** it's audited with before and after values, and can't set a delivery time in the future.

**Duplicates and cancellation:** a POD is recorded under a lock on its trip. A duplicate submission, such as a double tap or a retry after a lost response, always gets **409 `POD_EXISTS`** with the existing POD's id. A trip cancelled at the same moment either takes the POD first or rejects it with "This trip is cancelled"; nothing is stored in that case.

After it's recorded:
- **Signature:** cannot be replaced.
- **All or nothing:** files are validated and stored first; then the stop outcome, order status, POD record, attachment rows and audit entries are written in **one database transaction**. If anything fails, nothing is committed and the stored files are removed.
- **Duplicates and retries:** submissions for the same stop are serialised by a lock on the trip and by a unique POD per stop. A repeat, such as a retry after a lost response, gets **409 `POD_EXISTS`** naming the existing POD, and the app shows it as already recorded.
- **Edits:** text fields can be changed, and each change is written to the audit log with before and after values. Switching between *delivered* and *not delivered* is refused, because it would change the stop's outcome.
- **PDF:** **POD PDF** includes the photos, the signature and a verification QR.

## 6. Trip document section and pack

The trip page shows:
- **Compliance for this trip:** vehicle, driver and E-Way Bill checks, with blockers and warnings.
- **For each delivery:** its E-Way Bills, lorry receipts and POD.
- **The trip's invoices and challans.**

**Download document pack (ZIP)** returns:
- `MANIFEST.txt`: everything included, anything excluded and why, and files whose storage object is missing;
- LR PDFs and E-Way Bill copies;
- challan and invoice PDFs, for roles with `billing:read`;
- POD PDFs and photos;
- vehicle and driver document files, for roles with `documents:read`. KYC documents are always excluded.

A driver's pack only works for their own trips and leaves out fleet documents and billing. Every request is tenant-checked; another company's trip returns 404.

**Limits:**
- **Pack size:** packs are built in memory, so they're capped at `MAX_PACK_MB` (default 50 MB). Files beyond the cap are listed as `[omitted ]` in `MANIFEST.txt` and never loaded.
- **Per-user rate limits:** pack downloads at `PACK_RATE_LIMIT_PER_MIN` (default 6), and uploads (documents, E-Way Bills, PODs) at `UPLOAD_RATE_LIMIT_PER_MIN` (default 30). Going over returns 429.

**Orders with shipment documents can't be deleted.** An order with any E-Way Bill or lorry receipt, even a cancelled one, returns **409 `ORDER_HAS_SHIPMENT_DOCUMENTS`**; use **Cancel order** instead. This keeps the records and their stored files.

## 7. Compliance engine and dispatch

Source: `backend/src/modules/compliance/`. It is pure logic with unit tests, plus a service that loads records.

**States**
- **Per requirement:** `COMPLIANT`, `EXPIRING_SOON` (within *Settings → document alert days*), `EXPIRED`, `MISSING`, `PENDING_VERIFICATION`, `REJECTED` and `NOT_APPLICABLE`.
- **Per vehicle or driver:** the worst state among the required items, plus a list of **blockers** and **warnings**.

**Best copy wins.** For each type, the engine uses the non-rejected copy with the latest expiry. An expired old policy left next to a renewed one no longer blocks the vehicle. (Before this change, *any* expired copy blocked it.)

**Company policy** is part of company settings (`settings.compliance`) and is edited under **Settings → Compliance** (admins). Saving any settings section changes only that section: the API deep-merges partial updates into the stored settings and validates the result, so saving fuel prices can never reset the compliance policy. The defaults keep the earlier behaviour:

| Setting | Default | Meaning |
|---|---|---|
| `vehicleRequirements` | RC, insurance, PUC (exempt for `ELECTRIC`), fitness, permit | Required vehicle documents, with fuel-type and vehicle-type exemptions |
| `driverRequirements` | `["DRIVING_LICENSE"]` | Required driver documents (a licence copy) |
| `blockOnMissing` | `false` | Block when a required document is missing or only rejected copies exist |
| `blockOnUnverified` | `false` | Block until a required document is verified |
| `ewayBillValueThreshold` | `50000` | Declared value (₹) above which an E-Way Bill is expected. `null` turns the check off. The general GST rule is ₹50,000, but some states and goods differ, so set it for your business. |
| `blockOnMissingShipmentDocs` | `false` | Block dispatch when an expected E-Way Bill is missing or expired |

**These always block, whatever the settings:**
- an expired required vehicle document;
- an expired driving licence on the driver record;
- an inactive driver.

**Where it's enforced:**
- **OptiRoute planning and manual trips:** ineligible vehicles and drivers are excluded, with the exact reason (`INSURANCE expired on 2026-11-17`).
- **Dispatch (PLANNED → DISPATCHED):** re-checked inside the same database transaction that locks the vehicle and driver. A failure returns **409 `COMPLIANCE_BLOCKED`** listing every blocker, e.g. `Cannot dispatch: Vehicle HR26DK8337: PUC expired on 2026-11-10; ORD-…: E-Way Bill expected (declared value ₹75000 exceeds ₹50000) but none is recorded`.
- **Pre-check without dispatching:** `GET /api/compliance/check?vehicleId=&driverId=&orderIds=1,2`. It's for dispatch staff only (`trips:write`); drivers and employees get 403.

**Who sees what** in compliance results: the engine always evaluates everything, so eligibility never depends on the caller, but responses are trimmed per role.
- **Without `kyc:read`** (everyone except admins and managers): KYC items are removed, and any KYC-related blocker or warning is replaced by "A KYC record needs attention (details are visible to admins and managers only)".
- **Without `documents:read`** (drivers): document numbers and ids are blanked.

This applies to vehicle and driver detail, the compliance overview, the pre-check, trip documents and the 409 returned by dispatch.

Two outputs are shared by every role, so they never carry KYC detail at all:
- **OptiRoute plans:** exclusion reasons saved in the plan.
- **Manual trips:** the 422 returned when a manual trip is refused.

The driver is still excluded or refused in the same way. **Control Tower** expiry alerts include KYC documents only for callers with `kyc:read`.
- **Overview** (dashboard and Documents page): `GET /api/compliance/overview`.

> Legal applicability varies by vehicle category, goods, route and state. The defaults are a sensible starting point, not legal advice. Review `settings.compliance` with whoever handles your fleet's compliance.

## 8. Document storage

Source: `backend/src/lib/storage.ts`.

| `STORAGE_DRIVER` | Where files go | Persistent? |
|---|---|---|
| `local` (default) | `UPLOAD_DIR` on the server's disk | Locally, yes. **On Render's free plan, no:** the disk is wiped on every deploy and restart. `/api/health` reports `storage.persistent: false` in production. |
| `s3` | Any S3-compatible **private** bucket (AWS S3, Cloudflare R2, Backblaze B2, MinIO, …) | yes |

How files are kept private:
- **Object names:** each object is stored as `company-<id>/<random 128-bit key>`. The key is never derived from user input, so there's no path traversal and no cross-tenant addressing.
- **No public URLs:** every download first passes an authenticated, tenant- and role-checked API call.
- **Signed links:** `GET /api/attachments/:id/url` issues a **short-lived signed link** (`SIGNED_URL_TTL_SECONDS`, default 300 s). With S3 it's a presigned GET to the bucket; with local storage it's an HMAC-signed `/api/files/<token>` that cannot be forged or extended.
- **Audit log:** uploads, link issuance, downloads and deletions are recorded.
- **Deletion:** deleting a document, vehicle or driver deletes its stored objects too. There is **no automatic retention or expiry policy yet**: documents stay until deleted.

### Configuring S3-compatible storage

No provider is configured, and none was contacted during development. To use one:

1. Create a **private** bucket. Leave public access off, and set no bucket policy granting `s3:GetObject` to everyone.
2. Create an access key limited to that bucket, with `PutObject`, `GetObject` and `DeleteObject` only.
3. Set these on the backend (on Render: *Environment*):
   ```
   STORAGE_DRIVER=s3
   S3_BUCKET=raahsetu-documents
   S3_REGION=auto                    # AWS: e.g. ap-south-1
   S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com   # omit for AWS
   S3_ACCESS_KEY_ID=…
   S3_SECRET_ACCESS_KEY=…
   S3_FORCE_PATH_STYLE=false         # true for MinIO
   ```
4. Before redeploying, run the self-test from `backend/` with the same variables: `npm run storage:check`.
   - It writes one 64-byte synthetic object under `system-healthcheck/`, reads it back, opens a presigned link, checks that **unsigned** access is refused (the bucket is private), then deletes the object.
   - It contacts the provider, but never reads or writes customer documents and never prints keys.
5. Redeploy. Then upload a document and download it from the vehicle page, and check that `/api/health` shows `"driver":"s3","persistent":true`.

**Error handling:**
- **Missing object:** a file that doesn't exist returns **404**.
- **Storage unreachable or refusing requests** (network, credentials, permissions, quota): returns **503 `STORAGE_UNAVAILABLE`**, so an outage is never mistaken for a deleted file. For uploads the message says nothing was saved and the upload can be retried. Provider error details go to the server log only.
- **Integrity checksums:** the S3 client sends them only when an operation requires them, because several S3-compatible providers reject the newer default checksum trailers.
- **Encryption at rest:** RaahSetu doesn't request server-side encryption explicitly. AWS S3 and Cloudflare R2 encrypt new objects by default; for MinIO or self-hosted storage, enable encryption on the bucket.
- **Testing:** the S3 driver is tested offline against an in-process fake S3 server (`backend/tests/unit/storage.test.ts`). It has **not** been tested against a real provider.

Some providers charge for storage or requests, and some have free tiers; check yours before enabling it. Files already uploaded to local disk are **not migrated** automatically.

## 9. API summary

| Endpoint | Permission | Notes |
|---|---|---|
| `GET/POST /documents`, `GET/PATCH/DELETE /documents/:id` | documents:read / write | multipart fields `front`, `back`, `pages[]` (or legacy `file`) |
| `POST /documents/:id/files` | documents:write | add files; resets verification |
| `POST /documents/:id/verify` | documents:verify | `{ status: VERIFIED | REJECTED, reason }` |
| `GET /documents/:id/file` | documents:read | first file, authenticated download |
| `GET /attachments/:id`, `GET /attachments/:id/url`, `DELETE /attachments/:id` | depends on owner | 404 when not permitted |
| `GET /files/:token` | public, signed | expires after `SIGNED_URL_TTL_SECONDS` |
| `PUT /drivers/:id/kyc`, `POST /drivers/:id/kyc/verify` | kyc:write | `consent: true` required |
| `GET /compliance/overview` | documents:read | |
| `GET /compliance/check` | trips:write | `vehicleId`, `driverId`, `orderIds`, `at` |
| `GET/POST /eway-bills` (`?status=ACTIVE|CANCELLED`), `GET/PATCH /eway-bills/:id`, `POST /eway-bills/:id/files` | shipments:read / write | drivers: own trips only; edits and files refused (409) once cancelled; at most 5 files |
| `POST /eway-bills/:id/cancel` | shipments:write | body `{ reason }` (3–500 characters) |
| `GET /eway-bills/:id/history` | shipments:read | the record's audit trail with user names |
| `GET/POST /lorry-receipts` (`?status=`), `GET/PATCH /lorry-receipts/:id`, `GET …/pdf` | shipments:read / write | responses include `balanceAmount` and `editable`; PATCH refused (409) once finalized or cancelled |
| `POST /lorry-receipts/:id/finalize` | shipments:write | locks the LR and copies the company's LR terms |
| `POST /lorry-receipts/:id/cancel` | shipments:write | body `{ reason }` |
| `GET /lorry-receipts/:id/history` | shipments:read | |
| `GET /billing/:id/pdf` | billing:read | invoice or challan PDF |
| `GET/POST /pods`, `GET/PATCH /pods/:id`, `POST /pods/:id/photos`, `GET /pods/:id/pdf` | shipments:read, pod:write | drivers: own trips only |
| `GET /trips/:id/documents`, `GET /trips/:id/documents/pack` | shipments:read | filtered by role |

**New permissions**
- `documents:verify`, `kyc:read` and `kyc:write`: admin and manager.
- `shipments:read`: every role. Drivers are limited to their own trips.
- `shipments:write`: admin, manager and dispatcher.
- `pod:write`: admin, manager, dispatcher and driver (drivers on their own trips only, while in transit, never changing the outcome).
- `pod:resolve`: admin and manager (resolve a disputed delivery).

## 10. Database changes

Migration `20261118120000_transport_documents_compliance` is **additive only**:
- **New enum values:** `STATE_PERMIT`, `FASTAG`, `DRIVER_PHOTO` and `KYC_ID` in `DocumentType`.
- **New enums:** `VerificationStatus`, `AttachmentRole`, `OwnershipType`, `PodStatus`, `FreightPaymentTerms` and `ShipmentDocStatus`.
- **New columns:**
  - `Vehicle`: registration state, ownership, owner and FASTag.
  - `Driver`: licence class and issue date, address, emergency contact, and the KYC fields.
  - `ComplianceDocument`: verification status, verified-at and verified-by, and rejection reason.
  - `BillingDocument`: reason for transport and reference documents.
  - `BillingItem`: HSN code.
- **New tables:** `Attachment`, `EwayBill`, `LorryReceipt` and `ProofOfDelivery`.

Nothing is dropped, renamed or made stricter. Every new required column has a default. Existing documents start as `PENDING` verification, which does not block anything under the default policy.

Migration `20261119120000_transport_documents_lifecycle` is also **additive only**, with nullable columns:
- `EwayBill`: `validFrom`, `cancelledAt`, `cancelledById` and `cancelReason`.
- `LorryReceipt`: `advanceAmount`, `finalizedAt`, `finalizedById`, `termsSnapshot`, `cancelledAt`, `cancelledById` and `cancelReason`.

Existing LRs become **drafts** (no `finalizedAt`), so they stay editable until someone finalizes them. Company settings gain `transportDocuments.lrTerms`, a JSON key that defaults to empty and needs no migration.
