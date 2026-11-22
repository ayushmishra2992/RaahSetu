# RaahSetu — Final Implementation Roadmap

This roadmap follows from [FINAL_PRODUCT_AUDIT.md](FINAL_PRODUCT_AUDIT.md). The phases run in order, and a phase is ticked only when it is built, tested and documented.

## Business rules decided for this work

These are defaults. Each one can be changed later.

| Rule | Decision |
|---|---|
| Editing an LR | Allowed until the LR is **finalized** (a new "Finalize" action). After that, only cancellation is allowed. A cancelled LR cannot be edited. |
| Cancelling an E-Way Bill or LR | Asks for confirmation and a **reason of at least 3 characters**. The time, the user and the reason are stored. The record is kept; nothing is deleted. |
| E-Way Bill files | Up to 5 files per E-Way Bill. Files cannot be added to a cancelled record. |
| LR terms and conditions | Set by each company in Settings, and labelled "Terms set by <company>". The text is copied onto the LR when it is finalized, so later edits to the settings don't change issued LRs. RaahSetu writes no legal declarations of its own. |
| LR advance and balance | Advance is optional. Balance = freight − advance. A negative balance is rejected. |
| E-Way Bill validity | Valid from and valid until are recorded as shown on the government portal. RaahSetu does not generate or validate E-Way Bills. |

## Phase 2: Critical transport-document workflows ✅ (19 Nov 2026, see FINAL_IMPLEMENTATION_REPORT.md)

- [x] Migration `20261119120000_transport_documents_lifecycle`. It only adds nullable columns: E-Way Bill valid-from and cancellation fields; LR advance, terms snapshot, finalization and cancellation fields.
- [x] E-Way Bill API:
  - require a reason to cancel;
  - block files on cancelled records;
  - add a history endpoint;
  - add `validFrom`.
- [x] LR API:
  - add advance and balance;
  - add a finalize action, after which edits are blocked;
  - require a reason to cancel;
  - add a history endpoint;
  - load terms from settings.
- [x] LR PDF: show the driver, advance and balance, configurable terms and signature blocks.
- [x] Frontend:
  - a **Transport documents** register (E-Way Bills and LRs, with search and filters);
  - an E-Way Bill detail page (all fields, files, edit, add files, cancel, history);
  - an LR detail page (all fields, PDF view, download and print, edit, finalize, cancel, history);
  - links from the trip panels to these pages.
- [x] Settings: a field for the LR terms.
- [x] Tests: backend integration tests, plus browser tests using mocked API data.

## Phase 3: Business workflows

| Item | Size | Notes |
|---|---|---|
| ✅ Order detail | — | Already existed as the Orders drawer (the audit missed it). Phase 3a added the order's E-Way Bills, LRs and PODs to it. |
| ✅ POD dispute resolution and adding photos later in the UI | — | Done in Phase 3a, with race-safe POD updates |
| Order financials: freight, advance, payment status; consignee and goods fields | L | Schema change |
| Trip expenses and driver advances (fuel, toll, oil money) | L | New model, plus screens and permissions |
| Invoice payment records and outstanding balances on the dashboard | L | New model |
| Vehicle model, body type, dimensions; photo gallery | M | Schema change |
| User invitations and password reset by email | L | Needs an email provider (paid, needs approval) |

## Phase 4: UI/UX polish

- [x] Rename the trip billing button to "Create invoice / challan".
- [x] `/design-system`: checked; it is already development-only (`page.dev.tsx`).
- Run accessibility and responsive checks on every new screen.

## Phase 5: Storage and security

- Run the real-UI B2 end-to-end check against the dev bucket. It is paused and waiting for a manual login.
- Decide the B2 lifecycle (hidden versions) after the retention review. This is **your decision**: it is irreversible.

## Phases 6–8: Testing, documentation, release

- Run lint, typecheck, unit, integration, browser tests, the production build and `npm audit`.
- Write the final implementation report, the API, deployment and testing guides, and update the README.
- Release checklist:
  1. Back up the production database.
  2. Apply the migrations (approval needed).
  3. Set the environment variables on Render and Vercel (approval needed).
  4. Run the smoke tests.
