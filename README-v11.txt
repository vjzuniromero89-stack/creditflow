CreditFlow v11 — PostGrid TEST Connector

DATABASE
- Migration creditflow_postgrid_v11 already applied in Supabase.
- No SQL needs to be run manually.

REPLACE IN GITHUB
1. creditflow/wrangler.jsonc
2. creditflow/public/index.html
3. creditflow/public/assets/js/app.js

ADD IN GITHUB
4. creditflow/src/index-v11.js
5. creditflow/public/assets/js/sections/mailings-v11.js
6. creditflow/public/assets/css/postgrid-v11.css

CLOUDFLARE SECRET
POSTGRID_TEST_API_KEY (already added by user)

AFTER DEPLOY
1. Open CreditFlow > Envíos certificados.
2. Confirm TEST SANDBOX.
3. Click Probar conexión.
4. Prepare one letter that is already in estado Lista.
5. Click Enviar a TEST.
6. Confirm PostGrid returns an ID and live=false.

WEBHOOK — NEXT STEP
Endpoint already prepared:
https://creditflow.vjzuniromero89.workers.dev/api/webhooks/postgrid

Do not configure the webhook yet. First validate the test connection and one sandbox order.
Later create a PostGrid JSON webhook and save its signing secret in Cloudflare as POSTGRID_WEBHOOK_SECRET.

v11 intentionally does not use any Live API key and does not mark letters as physically sent.
