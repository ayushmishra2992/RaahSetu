# RaahSetu — Final Implementation Report

**Date:** 19 November 2026
**Branch:** `feature/raahsetu-3-final`. Not committed yet: waiting for review.

This report covers what was built in this pass and how it was verified. It also says what is **not** done. For the baseline, see [FINAL_PRODUCT_AUDIT.md](FINAL_PRODUCT_AUDIT.md); for the remaining plan, see [FINAL_IMPLEMENTATION_ROADMAP.md](FINAL_IMPLEMENTATION_ROADMAP.md).

## Done in this pass

### E-Way Bill: now fully managed from the UI

| Capability | Where |
|---|---|
| Record (with the portal copy) | Trip → order panel → **Record E-Way Bill** (unchanged) |
| Full details: every field, files, validity, status | **Transport Documents → E-Way Bills → number**, or the number on the trip panel |
| Edit | **Edit details** (`shipments:write`, active records only) |
| Add files after recording | **Add files** (5 in total; refused on cancelled records) |
| Open or download files | **Open** (short-lived private link) |
| Cancel | **Cancel record**, with a confirmation and a required reason. Time, user and reason are stored. |
| Valid, expired and cancelled status | Badges on the register, the detail page and the trip panel |
| History | History card (recorded, edited, files added, cancelled, with the user's name) |
| Validity start | New **Valid from** field |

RaahSetu still only **records** E-Way Bills, and the UI says so on the form, the detail page and the cancel dialog. It does not generate them, extend them, or cancel them on the government portal.

### Lorry receipt (bilty): full lifecycle

| Capability | Where |
|---|---|
| Issue from an order and trip, filled in automatically | Trip → order panel → **Issue LR**, which now includes **Advance received** |
| Full details, including freight, advance and balance, trip, vehicle and driver | **Transport Documents → Lorry receipts → number** |
| Edit (drafts only) | **Edit**: every field, including consignor, consignee, places, weights and declared value |
| Finalize | **Finalize**, with a confirmation. The LR is locked and the company's terms are copied onto it. |
| Cancel | **Cancel LR**, with a required reason, from draft or final |
| PDF: view, print, download | **View / print PDF** (new tab) and **Download PDF** |
| History | Created, edited, finalized, PDF downloaded, cancelled |

The **LR PDF** is reworked. It shows:
- a status line (Draft, Final or Cancelled, with the reason);
- the trip reference;
- vehicle and type, driver and phone, driver licence;
- advance received and balance.

The previous hard-coded "owner's risk" sentence has been **removed**. Terms now come only from **Settings → Transport documents**, labelled "Terms and conditions set by *company*". If the field is empty, no terms are printed.

### Transport Documents register (new sidebar item)

Every role with `shipments:read` can open it. It lists **E-Way Bills, lorry receipts and proofs of delivery** across all trips, with:
- search;
- status filters (Valid, Expired, Cancelled / Draft, Final, Cancelled / POD outcomes);
- mobile cards;
- links to each record.

It also links to the existing **Invoices & challans** and **Vehicle & driver compliance** registers. Those documents are not duplicated.

### Smaller changes

- The trip page's billing button now says **"Create invoice / challan"**.
- Adding E-Way Bill files is now all-or-nothing: if one file fails to store, the files already stored for that request are removed.
- Correction to the audit: `/design-system` is **not** exposed in production. It is development-only by design.

### Delivery challan and invoices

These were not changed. Their tests still pass, and they remain fully functional.

## Phase 3a: workflow gaps that needed no migration

These were done after the Phase 2 commit (`c4800ae`) and are **not committed yet**.

| Change | Where |
|---|---|
| **POD dispute resolution in the UI.** Admins and managers (`pod:resolve`) get **Resolve dispute** on a disputed POD. They pick the agreed outcome (in full or partial) and give a delivered quantity, shortage or damage details, and required remarks. The form checks the same rules as the API. | Trip → order panel → Proof of delivery |
| **Add POD photos later.** Up to 8 photos in total. Existing photos can be opened. | Same panel |
| **POD remarks shown**, and other roles see a note explaining who resolves disputes | Same panel |
| **Order drawer lists the order's paperwork**: E-Way Bills, LRs (Draft / Final / Cancelled) and PODs, each linked to its record or PDF. Only roles with `shipments:read` see it. | Orders → open an order |
| **POD edits are race-safe.** The update applies only to the version that was checked (same `updatedAt`), with its history entry in the same transaction. Otherwise it returns 409. | `pods.routes.ts` |
| **POD photo uploads are all-or-nothing.** A storage failure removes the photos already stored by that request. | `pods.routes.ts` |
| **E-Way Bill file uploads lock the record.** A cancellation either waits for the upload or wins first, and then the upload gets 409. Two simultaneous uploads can't exceed the 5-file limit. Objects already stored are removed on failure. | `ewayBills.routes.ts` |

## Database

There is one new migration, **`20261119120000_transport_documents_lifecycle`**. It is additive and only adds nullable columns:
- `EwayBill`: `validFrom`, `cancelledAt`, `cancelledById`, `cancelReason`.
- `LorryReceipt`: `advanceAmount`, `finalizedAt`, `finalizedById`, `termsSnapshot`, `cancelledAt`, `cancelledById`, `cancelReason`.

Existing LRs become drafts. Company settings gain the JSON key `transportDocuments.lrTerms`, which defaults to empty.

| Database | What happened |
|---|---|
| `raahsetu_test` | Rebuilt by the test setup from all committed migrations, including the new one. It applied cleanly. |
| `raahsetu_dev` | **Migrated on 19 Nov 2026**, after a verified backup (`C:\Users\Ayush Mishra\RaahSetu-backups\raahsetu_dev-before-transport_documents_lifecycle-20261119-230052.dump`). All 5 migrations are applied and the company count is unchanged (2). |
| `raahsetu` (protected) | Not touched |
| Production (Neon) | Not touched |

## Verification

All of these were run on 19 November 2026 against the working tree.

| Check | Result |
|---|---|
| Backend typecheck and lint | ✅ clean |
| Backend tests: unit and integration (`raahsetu_test`) | ✅ **unit 167 passed; integration 88 passed** (two consecutive runs, 0 failed, 0 skipped). This includes the race tests: simultaneous E-Way Bill cancels, edit vs cancel, upload vs cancel, simultaneous uploads against the file limit, and concurrent POD dispute resolution. |
| Frontend typecheck and lint (`--max-warnings=0`) | ✅ clean |
| Frontend unit tests | ✅ **99 passed**, including new breadcrumb tests |
| Frontend production build | ✅ the new routes build |
| Browser tests, mocked API, Edge, production build | ✅ **245 passed**, 0 failed, 85 skipped. The skips are intentional: 84 screenshot-capture tests run only with `SCREENSHOT_DIR`, and 1 component-catalogue test is dev-only. Coverage includes the register, E-Way Bill and LR pages, role-specific links, dispute resolution, adding POD photos and the order drawer's documents. |
| `npm audit --omit=dev` (backend and frontend) | ✅ **0 vulnerabilities** |
| `npm audit` including dev dependencies | ⚠️ 7 moderate, in `minimatch` inside the `typescript-eslint` lint tooling. Dev-only and not shipped. Left for a separate tooling upgrade. |

## Not verified

- The new screens against a **real backend in a browser**. Browser tests use a mocked API, and integration tests cover the real API. `raahsetu_dev` is now migrated, but the browser check against it needs a manual login, which hasn't happened yet.
- **Backblaze B2 through the UI.** The session was paused before login. Only the B2 storage self-test (`storage:check`) has passed.
- **Print layout** of the PDF on paper. The PDF is generated and checked to be a valid PDF; how it looks was not checked.

## Still to do

Phase 3 and later in the roadmap are still **open**. This pass did not build:
- an order detail page;
- the UI for resolving POD disputes and adding photos later;
- order and trip financials (freight, advances, oil money, expenses, payment status);
- invoice payment records and outstanding balances;
- vehicle model, body type, dimensions and a photo gallery;
- user invitations and password reset by email (needs a paid email provider);
- the broad UI polish pass.

Several of these need schema changes and business-rule decisions. They are listed with sizes in the roadmap.

## Release implication: existing lorry receipts

The lifecycle migration adds `finalizedAt` as an empty column and **doesn't change existing records**. So every LR issued before this release becomes a **Draft** under the new lifecycle:
- it shows as Draft in the UI and remains editable;
- its PDF is marked as a draft;
- its PDF no longer prints the old hard-coded "owner's risk" terms sentence.

Existing LRs are deliberately **not** finalized in bulk. Finalizing them, or giving them a separate "legacy" status, would need a deliberately designed and separately approved data migration. Until then, finalize a pre-release LR from its page if it should be locked.

## Release steps (when approved)

1. Review this branch and approve a commit.
2. Back up Neon production.
3. Apply `20261118120000_transport_documents_compliance` and `20261119120000_transport_documents_lifecycle` with `npm run db:deploy` (approval required).
4. Set the S3 and B2 production variables on Render, using the separate `raahsetu-documents` bucket (approval required).
5. Deploy the backend, then the frontend.
6. Smoke test:
   - check that health reports `storage.persistent=true`;
   - record an E-Way Bill with a synthetic PDF on a test company, then open it, add a file and cancel it;
   - issue an LR, then edit, finalize, download the PDF and cancel it;
   - confirm that unauthenticated access to a file link returns 401.
