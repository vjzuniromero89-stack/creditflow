CREDITFLOW PROFESSIONAL v14 — FULL PROJECT

This ZIP is a complete project, built from the latest creditflow-main.zip supplied by the owner.
It is NOT a partial patch.

ACTIVE CLIENT FLOW
1. Create/open client
2. Report tab -> AnnualCreditReport.com -> Import PDF
3. CreditFlow classifies report data into focused tabs:
   - Collections
   - Charge-Offs
   - Late Payments
   - Inquiries
   - Settled
   - Personal Information / Addresses
4. Resume -> Start/Complete strategy
5. Letters -> review/approve
6. Mailings:
   - Credit bureaus: grouped Certified Mail
   - Creditor/collector: print + normal stamp queue
7. History -> results and billing

CLEANUP
- Main navigation simplified: Dashboard, Clients, Results/Billing, Letters, Mailings, Templates, Client Portal, System.
- Client workspace simplified and reorganized.
- Legacy visible Strategy Intelligence, Audit, Aggressive Compliance and Workflow Guard modules removed from active frontend.
- Old backend chain remains where needed for compatibility with existing API routes and data.
- Existing Supabase data is preserved.

DEPLOY
Upload/replace the complete contents of this project in GitHub.
Cloudflare entry remains creditflow/src/index-v13-5.js via creditflow/wrangler.jsonc.
No wrangler variable changes are required.
