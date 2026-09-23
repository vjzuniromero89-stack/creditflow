CREDITFLOW v15 — SMART CREDIT REPAIR — FULL PROJECT

This ZIP is the complete project.

MAJOR CHANGES
- Removed the Envíos / Envíos certificados tab from the active application.
- Removed the old visible strategy workflow.
- New client workflow:
  1. Client record / intake
  2. Credit report import
  3. Automatic classification
  4. Generate letters
  5. Experian / Equifax / TransUnion package tabs
  6. Print full bureau package
  7. Mark bureau package sent
  8. Generate next round when prior round was sent
- Round 1 automatically includes a personal-information review letter for each bureau plus bureau-specific negative-item letters.
- ID and proof-of-address are appended to the printable package when available.
- Round 2 uses template 62.
- Round 3 uses template 63.
- Removed PostGrid from the active workflow. Mailing is now handled outside the app after printing.
- Added a secure 30-day client intake link.
- Intake collects: full name, address, city/state/ZIP, phone, email, last 4 SSN, photo ID, and proof-of-address/bill.
- Submitted intake updates the client record and stores the two documents automatically.

DATABASE
Run migration:
creditflow/migrations/2026-09-23-v15-client-intake.sql

IMPORTANT
The connected Supabase account did not grant permission to apply this migration from ChatGPT, so it is included in the complete ZIP and must be applied in Supabase before using the intake-link feature.

DEPLOY
Replace the current repository contents with this complete project, keeping your existing Cloudflare secrets.
