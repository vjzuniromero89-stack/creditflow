import baseWorker from "./index.js";
import { createD1Shim } from "./db-shim.js";

const FEE_COL = {
  coleccion: "fee_coleccion",
  charge_off: "fee_charge_off",
  pago_tardio: "fee_pago_tardio",
  liquidada: "fee_liquidada",
  repossesion: "fee_repossesion",
  foreclosure: "fee_foreclosure",
  bancarrota: "fee_bancarrota",
  inquiry: "fee_inquiry",
  otro: "fee_otro",
};

const LABEL = {
  coleccion: "Colecciones",
  charge_off: "Charge-offs",
  pago_tardio: "Pagos tardíos",
  liquidada: "Cuentas liquidadas",
  repossesion: "Repossession",
  foreclosure: "Foreclosure",
  bancarrota: "Bancarrota",
  inquiry: "Inquiries",
  otro: "Otros",
};

const CATEGORIES = Object.keys(FEE_COL);

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function bureauCount(raw) {
  const parts = String(raw || "")
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  return new Set(parts).size || 1;
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function ensureAutomationTables(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS report_imports (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL,
      file_name TEXT,
      provider TEXT,
      report_date DATE,
      file_hash TEXT,
      item_count INTEGER NOT NULL DEFAULT 0,
      address_count INTEGER NOT NULL DEFAULT 0,
      score_count INTEGER NOT NULL DEFAULT 0,
      parser_status TEXT NOT NULL DEFAULT 'ok',
      parser_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).run();

  await db.prepare(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_report_imports_client_hash
    ON report_imports(client_id, file_hash)
    WHERE file_hash IS NOT NULL
  `).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_report_imports_client_date
    ON report_imports(client_id, report_date DESC, created_at DESC)
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS removal_events (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT NOT NULL,
      credit_item_id BIGINT NOT NULL,
      bureau TEXT,
      category TEXT NOT NULL,
      creditor_name TEXT,
      account_number TEXT,
      detected_report_id BIGINT,
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status TEXT NOT NULL DEFAULT 'confirmed',
      confidence NUMERIC(5,4) NOT NULL DEFAULT 1.0,
      amount NUMERIC(12,2),
      billing_status TEXT NOT NULL DEFAULT 'pendiente',
      notes TEXT,
      UNIQUE (credit_item_id, bureau)
    )
  `).run();

  // Compatible con la tabla automation-v1 que ya pudo haberse creado antes.
  await db.prepare(`ALTER TABLE removal_events ADD COLUMN IF NOT EXISTS units INTEGER NOT NULL DEFAULT 1`).run();
  await db.prepare(`ALTER TABLE removal_events ADD COLUMN IF NOT EXISTS reappeared_at TIMESTAMPTZ`).run();
  await db.prepare(`ALTER TABLE removal_events ADD COLUMN IF NOT EXISTS last_seen_report_id BIGINT`).run();

  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_removal_events_client
    ON removal_events(client_id, detected_at DESC)
  `).run();

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS automation_events (
      id BIGSERIAL PRIMARY KEY,
      client_id BIGINT,
      event_type TEXT NOT NULL,
      event_status TEXT NOT NULL DEFAULT 'ok',
      detail TEXT,
      metadata_json TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).run();
}

async function authOk(request, env, ctx) {
  const u = new URL(request.url);
  u.pathname = "/api/auth/status";
  u.search = "";
  const probe = new Request(u.toString(), {
    method: "GET",
    headers: request.headers,
  });
  const resp = await baseWorker.fetch(probe, env, ctx);
  if (!resp.ok) return false;
  try {
    const data = await resp.json();
    return !!data.authenticated;
  } catch {
    return false;
  }
}

async function pricingForClient(db, clientId) {
  const general = (await db.prepare(`SELECT * FROM pricing_settings WHERE id = 1`).first()) || {};
  const custom = clientId
    ? (await db.prepare(`SELECT * FROM client_pricing WHERE client_id = ?`).bind(clientId).first()) || {}
    : {};

  const fee = {};
  for (const cat of CATEGORIES) {
    const col = FEE_COL[cat];
    const customVal = custom[col];
    const generalVal = general[col];
    fee[cat] =
      customVal !== undefined && customVal !== null
        ? Number(customVal || 0)
        : Number(generalVal || 0);
  }
  return { general, custom, fee };
}

async function backfillCurrentRemoved(db, clientId = null, reportId = null) {
  let sql = `SELECT * FROM credit_items WHERE removed_status = 'eliminado'`;
  const params = [];
  if (clientId) {
    sql += ` AND client_id = ?`;
    params.push(clientId);
  }
  const { results } = await db.prepare(sql).bind(...params).all();

  const pricingCache = new Map();
  let created = 0;

  for (const item of results || []) {
    if (!pricingCache.has(item.client_id)) {
      pricingCache.set(item.client_id, await pricingForClient(db, item.client_id));
    }
    const { fee } = pricingCache.get(item.client_id);
    const units = bureauCount(item.bureaus);
    const amount = Number(fee[item.category] || fee.otro || 0) * units;

    const existing = await db
      .prepare(`SELECT id FROM removal_events WHERE credit_item_id = ? AND COALESCE(bureau, '') = ?`)
      .bind(item.id, item.bureaus || "")
      .first();

    if (!existing) {
      await db.prepare(`
        INSERT INTO removal_events
          (client_id, credit_item_id, bureau, category, creditor_name, account_number,
           detected_report_id, status, confidence, amount, billing_status, units, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', 1.0, ?, ?, ?, ?)
        ON CONFLICT (credit_item_id, bureau) DO NOTHING
      `)
        .bind(
          item.client_id,
          item.id,
          item.bureaus || "",
          item.category || "otro",
          item.creditor_name || null,
          item.account_number || null,
          reportId,
          amount,
          item.billing_status || "pendiente",
          units,
          "Remoción confirmada automáticamente por comparación de reportes."
        )
        .run();
      created++;
    } else {
      await db.prepare(`
        UPDATE removal_events
        SET billing_status = ?, status = 'confirmed', last_seen_report_id = COALESCE(?, last_seen_report_id)
        WHERE id = ?
      `).bind(item.billing_status || "pendiente", reportId, existing.id).run();
    }
  }
  return created;
}

async function markReappearedEvents(db, clientId, reportId) {
  const { results } = await db.prepare(`
    SELECT re.id, re.credit_item_id
    FROM removal_events re
    JOIN credit_items ci ON ci.id = re.credit_item_id
    WHERE re.client_id = ? AND ci.removed_status = 'activo'
  `).bind(clientId).all();

  for (const ev of results || []) {
    await db.prepare(`
      UPDATE removal_events
      SET status = 'reappeared',
          reappeared_at = COALESCE(reappeared_at, NOW()),
          last_seen_report_id = COALESCE(?, last_seen_report_id)
      WHERE id = ?
    `).bind(reportId, ev.id).run();
  }
  return (results || []).length;
}

async function deriveReportDate(db, clientId, fileName) {
  const row = await db.prepare(`
    SELECT recorded_on
    FROM credit_scores
    WHERE client_id = ? AND notes = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(clientId, fileName).first();
  return row?.recorded_on || new Date().toISOString().slice(0, 10);
}

async function recordImport(db, clientId, fileName, hash, data) {
  const reportDate = await deriveReportDate(db, clientId, fileName);
  const result = await db.prepare(`
    INSERT INTO report_imports
      (client_id, file_name, provider, report_date, file_hash,
       item_count, address_count, score_count, parser_status, parser_notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ok', ?)
    RETURNING *
  `).bind(
    clientId,
    fileName,
    data.format || null,
    reportDate,
    hash,
    Number(data.inserted || 0) + Number(data.skipped_duplicates || 0),
    Number(data.addresses_added || 0) + Number(data.addresses_updated || 0),
    Number(data.scores_imported || 0),
    null
  ).first();
  return result;
}

async function interceptCreditReportImport(request, env, ctx, clientId) {
  const db = env.DB;
  await ensureAutomationTables(db);

  const form = await request.clone().formData();
  const file = form.get("file");
  if (!file || typeof file === "string") {
    return baseWorker.fetch(request, env, ctx);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256Hex(bytes);

  const duplicate = await db.prepare(`
    SELECT id, file_name, report_date, created_at
    FROM report_imports
    WHERE client_id = ? AND file_hash = ?
    LIMIT 1
  `).bind(clientId, hash).first();

  if (duplicate) {
    return json({
      error: "Este mismo PDF ya fue importado para este cliente.",
      duplicate_report: true,
      previous_import: duplicate,
    }, 409);
  }

  const response = await baseWorker.fetch(request, env, ctx);
  if (!response.ok) return response;

  let data;
  try {
    data = await response.clone().json();
  } catch {
    return response;
  }

  const report = await recordImport(db, clientId, file.name || "reporte.pdf", hash, data);
  const eventsCreated = await backfillCurrentRemoved(db, clientId, report?.id || null);
  const reappeared = await markReappearedEvents(db, clientId, report?.id || null);

  await db.prepare(`
    INSERT INTO automation_events (client_id, event_type, event_status, detail, metadata_json)
    VALUES (?, 'credit_report_imported', 'ok', ?, ?)
  `).bind(
    clientId,
    `${file.name || "reporte.pdf"} — ${eventsCreated} remoción(es) histórica(s) registradas`,
    JSON.stringify({
      report_import_id: report?.id || null,
      file_hash: hash,
      removals_created: eventsCreated,
      reappeared,
    })
  ).run();

  return json({
    ...data,
    report_import_id: report?.id || null,
    report_hash: hash,
    removal_events_created: eventsCreated,
    removal_events_reappeared: reappeared,
  }, response.status);
}

async function getEventEarnings(db, clientId = null) {
  await ensureAutomationTables(db);
  await backfillCurrentRemoved(db, clientId);

  const categories = {};
  for (const cat of CATEGORIES) {
    categories[cat] = {
      category: cat,
      label: LABEL[cat],
      fee: 0,
      pending_count: 0,
      pending_amount: 0,
      real_count: 0,
      real_amount: 0,
      paid_count: 0,
      paid_amount: 0,
      owed_count: 0,
      owed_amount: 0,
      reappeared_count: 0,
    };
  }

  // Potencial = lo que todavía aparece. Usa tarifa actual.
  let itemSql = `SELECT * FROM credit_items WHERE removed_status = 'activo'`;
  const itemParams = [];
  if (clientId) {
    itemSql += ` AND client_id = ?`;
    itemParams.push(clientId);
  }
  const { results: activeItems } = await db.prepare(itemSql).bind(...itemParams).all();

  const pricingCache = new Map();
  for (const item of activeItems || []) {
    if (!categories[item.category]) continue;
    if (!pricingCache.has(item.client_id)) {
      pricingCache.set(item.client_id, await pricingForClient(db, item.client_id));
    }
    const { fee } = pricingCache.get(item.client_id);
    const units = bureauCount(item.bureaus);
    const f = Number(fee[item.category] || 0);
    categories[item.category].fee = f;
    categories[item.category].pending_count += units;
    categories[item.category].pending_amount += f * units;
  }

  // Real = eventos históricos de remoción. Usa tarifa congelada en amount.
  let evSql = `SELECT * FROM removal_events`;
  const evParams = [];
  if (clientId) {
    evSql += ` WHERE client_id = ?`;
    evParams.push(clientId);
  }
  const { results: events } = await db.prepare(evSql).bind(...evParams).all();

  for (const ev of events || []) {
    if (!categories[ev.category]) continue;
    const units = Number(ev.units || 1);
    const amount = Number(ev.amount || 0);
    const c = categories[ev.category];
    c.real_count += units;
    c.real_amount += amount;
    if (ev.billing_status === "pagado") {
      c.paid_count += units;
      c.paid_amount += amount;
    } else {
      c.owed_count += units;
      c.owed_amount += amount;
    }
    if (ev.status === "reappeared") c.reappeared_count += units;
  }

  // Para que la UI siempre tenga la tarifa aunque no haya ítems activos.
  if (clientId) {
    const { fee } = await pricingForClient(db, clientId);
    for (const cat of CATEGORIES) categories[cat].fee ||= Number(fee[cat] || 0);
  } else {
    const { fee } = await pricingForClient(db, null);
    for (const cat of CATEGORIES) categories[cat].fee ||= Number(fee[cat] || 0);
  }

  const rows = Object.values(categories);
  const totals = rows.reduce((a, c) => ({
    pending: a.pending + c.pending_amount,
    real: a.real + c.real_amount,
    paid: a.paid + c.paid_amount,
    owed: a.owed + c.owed_amount,
    pending_count: a.pending_count + c.pending_count,
    real_count: a.real_count + c.real_count,
    paid_count: a.paid_count + c.paid_count,
    owed_count: a.owed_count + c.owed_count,
    total_count: a.total_count + c.pending_count + c.real_count,
    reappeared_count: a.reappeared_count + c.reappeared_count,
  }), {
    pending: 0, real: 0, paid: 0, owed: 0,
    pending_count: 0, real_count: 0, paid_count: 0, owed_count: 0,
    total_count: 0, reappeared_count: 0,
  });

  return { categories: rows, totals };
}

async function getEarningsByClient(db) {
  await ensureAutomationTables(db);
  await backfillCurrentRemoved(db, null);

  const { results: clients } = await db.prepare(`SELECT id, full_name FROM clients`).all();
  const out = [];
  for (const client of clients || []) {
    const { totals } = await getEventEarnings(db, client.id);
    if (!totals.real && !totals.pending) continue;
    out.push({
      client_id: client.id,
      client_name: client.full_name,
      real_amount: totals.real,
      paid_amount: totals.paid,
      owed_amount: totals.owed,
      pending_amount: totals.pending,
      real_count: totals.real_count,
      paid_count: totals.paid_count,
      owed_count: totals.owed_count,
      pending_count: totals.pending_count,
      reappeared_count: totals.reappeared_count,
    });
  }
  out.sort((a, b) => b.real_amount - a.real_amount);
  return out;
}

async function removalEventsList(request, db) {
  await ensureAutomationTables(db);
  await backfillCurrentRemoved(db, null);

  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  let sql = `
    SELECT re.*, c.full_name AS client_name
    FROM removal_events re
    JOIN clients c ON c.id = re.client_id
  `;
  const params = [];
  if (clientId) {
    sql += ` WHERE re.client_id = ?`;
    params.push(clientId);
  }
  sql += ` ORDER BY re.detected_at DESC, re.id DESC LIMIT 250`;

  const { results } = await db.prepare(sql).bind(...params).all();
  return results || [];
}

async function syncBillingEvent(db, creditItemId) {
  await ensureAutomationTables(db);
  const item = await db.prepare(`SELECT billing_status FROM credit_items WHERE id = ?`).bind(creditItemId).first();
  if (!item) return;
  await db.prepare(`
    UPDATE removal_events SET billing_status = ? WHERE credit_item_id = ?
  `).bind(item.billing_status || "pendiente", creditItemId).run();
}

export default {
  async fetch(request, env, ctx) {
    const db = createD1Shim(env);
    const runtimeEnv = { ...env, DB: db };
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    // Solo interceptamos API internas; assets y portal siguen pasando al Worker original.
    if (path.startsWith("/api/")) {
      const authenticated = await authOk(request, runtimeEnv, ctx);
      const isAuthRoute = path.startsWith("/api/auth/");
      const isPortalRoute = path.startsWith("/api/portal/");
      if (!authenticated && !isAuthRoute && !isPortalRoute) {
        return baseWorker.fetch(request, runtimeEnv, ctx);
      }

      const reportMatch = path.match(/^\/api\/clients\/(\d+)\/credit-report\/import$/);
      if (reportMatch && method === "POST") {
        return interceptCreditReportImport(request, runtimeEnv, ctx, reportMatch[1]);
      }

      if (path === "/api/credit-items/earnings" && method === "GET") {
        const clientId = url.searchParams.get("client_id");
        const data = await getEventEarnings(db, clientId || null);
        const pricing = (await pricingForClient(db, clientId || null)).general;
        return json({ ...data, pricing });
      }

      if (path === "/api/credit-items/earnings-by-client" && method === "GET") {
        return json({ clients: await getEarningsByClient(db) });
      }

      if (path === "/api/removal-events" && method === "GET") {
        return json({ events: await removalEventsList(request, db) });
      }

      const billingMatch = path.match(/^\/api\/credit-items\/(\d+)\/billing-status$/);
      if (billingMatch && method === "PUT") {
        const resp = await baseWorker.fetch(request, runtimeEnv, ctx);
        if (resp.ok) await syncBillingEvent(db, billingMatch[1]);
        return resp;
      }
    }

    return baseWorker.fetch(request, runtimeEnv, ctx);
  },
};
