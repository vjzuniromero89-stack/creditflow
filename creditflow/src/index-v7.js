import autoWorker from "./index-auto.js";
import { createD1Shim } from "./db-shim.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function authOk(request, env, ctx) {
  const u = new URL(request.url);
  u.pathname = "/api/auth/status";
  u.search = "";
  const probe = new Request(u.toString(), { method: "GET", headers: request.headers });
  const resp = await autoWorker.fetch(probe, env, ctx);
  if (!resp.ok) return false;
  try {
    const data = await resp.json();
    return !!data.authenticated;
  } catch {
    return false;
  }
}

function cleanText(v, max = 500) {
  return String(v ?? "").trim().slice(0, max);
}

function moneyNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function listPaymentEvents(db, request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  const removalEventId = url.searchParams.get("removal_event_id");
  let sql = `
    SELECT pe.*, c.full_name AS client_name,
           re.creditor_name, re.account_number, re.bureau, re.category
    FROM payment_events pe
    LEFT JOIN clients c ON c.id = pe.client_id
    LEFT JOIN removal_events re ON re.id = pe.removal_event_id
    WHERE 1=1
  `;
  const params = [];
  if (clientId) {
    sql += ` AND pe.client_id = ?`;
    params.push(clientId);
  }
  if (removalEventId) {
    sql += ` AND pe.removal_event_id = ?`;
    params.push(removalEventId);
  }
  sql += ` ORDER BY pe.created_at DESC, pe.id DESC LIMIT 500`;
  const { results } = await db.prepare(sql).bind(...params).all();
  return results || [];
}

async function listReportImports(db, request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  let sql = `SELECT * FROM report_imports WHERE 1=1`;
  const params = [];
  if (clientId) {
    sql += ` AND client_id = ?`;
    params.push(clientId);
  }
  sql += ` ORDER BY report_date DESC NULLS LAST, created_at DESC, id DESC LIMIT 200`;
  const { results } = await db.prepare(sql).bind(...params).all();
  return results || [];
}

async function listAutomationEvents(db, request) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  let sql = `SELECT * FROM automation_events WHERE 1=1`;
  const params = [];
  if (clientId) {
    sql += ` AND client_id = ?`;
    params.push(clientId);
  }
  sql += ` ORDER BY created_at DESC, id DESC LIMIT 250`;
  const { results } = await db.prepare(sql).bind(...params).all();
  return results || [];
}

async function recordPayment(request, db, removalEventId) {
  let body = {};
  try {
    body = await request.json();
  } catch {}

  const event = await db.prepare(`
    SELECT re.*, ci.billing_status AS item_billing_status
    FROM removal_events re
    LEFT JOIN credit_items ci ON ci.id = re.credit_item_id
    WHERE re.id = ?
  `).bind(removalEventId).first();

  if (!event) return json({ error: "Remoción no encontrada." }, 404);
  if (event.billing_status === "pagado") {
    return json({ error: "Esta remoción ya está marcada como pagada." }, 409);
  }

  const amount = moneyNumber(body.amount || event.amount);
  if (amount <= 0) return json({ error: "El monto del pago debe ser mayor que cero." }, 400);

  const method = cleanText(body.payment_method || "otro", 80);
  const reference = cleanText(body.payment_reference || "", 160);
  const notes = cleanText(body.notes || "", 1000);

  const payment = await db.prepare(`
    INSERT INTO payment_events
      (client_id, credit_item_id, removal_event_id, amount, payment_method,
       payment_reference, notes, event_type)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'payment_recorded')
    RETURNING *
  `).bind(
    event.client_id,
    event.credit_item_id,
    event.id,
    amount,
    method || null,
    reference || null,
    notes || null
  ).first();

  await db.prepare(`
    UPDATE removal_events
    SET billing_status = 'pagado',
        paid_at = NOW(),
        payment_method = ?,
        payment_reference = ?
    WHERE id = ?
  `).bind(method || null, reference || null, event.id).run();

  if (event.credit_item_id) {
    await db.prepare(`
      UPDATE credit_items
      SET billing_status = 'pagado'
      WHERE id = ?
    `).bind(event.credit_item_id).run();
  }

  await db.prepare(`
    INSERT INTO automation_events (client_id, event_type, event_status, detail, metadata_json)
    VALUES (?, 'payment_recorded', 'ok', ?, ?)
  `).bind(
    event.client_id,
    `${event.creditor_name || "Ítem removido"} — pago ${amount.toFixed(2)} (${method || "otro"})`,
    JSON.stringify({
      removal_event_id: event.id,
      credit_item_id: event.credit_item_id,
      amount,
      payment_method: method,
      payment_reference: reference || null,
    })
  ).run();

  return json({ ok: true, payment });
}

async function syncLegacyBillingChange(request, response, db, creditItemId) {
  if (!response.ok) return response;

  let body = {};
  try {
    body = await request.clone().json();
  } catch {}
  const nextStatus = body.billing_status;
  if (!nextStatus) return response;

  const event = await db.prepare(`
    SELECT * FROM removal_events
    WHERE credit_item_id = ?
    ORDER BY detected_at DESC, id DESC
    LIMIT 1
  `).bind(creditItemId).first();

  if (!event) return response;

  if (nextStatus === "pagado") {
    const existing = await db.prepare(`
      SELECT id FROM payment_events
      WHERE removal_event_id = ? AND event_type = 'legacy_paid'
      ORDER BY id DESC LIMIT 1
    `).bind(event.id).first();

    if (!existing) {
      await db.prepare(`
        INSERT INTO payment_events
          (client_id, credit_item_id, removal_event_id, amount,
           payment_method, notes, event_type)
        VALUES (?, ?, ?, ?, 'sin_especificar',
                'Pago marcado desde el control anterior de CreditFlow.',
                'legacy_paid')
      `).bind(
        event.client_id,
        event.credit_item_id,
        event.id,
        moneyNumber(event.amount)
      ).run();
    }
    await db.prepare(`
      UPDATE removal_events
      SET paid_at = COALESCE(paid_at, NOW()),
          payment_method = COALESCE(payment_method, 'sin_especificar')
      WHERE id = ?
    `).bind(event.id).run();
  }

  return response;
}

export default {
  async fetch(request, env, ctx) {
    const runtimeEnv = { ...env, DB: createD1Shim(env) };
    const db = runtimeEnv.DB;
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    if (!path.startsWith("/api/")) {
      return autoWorker.fetch(request, runtimeEnv, ctx);
    }

    const authenticated = await authOk(request, runtimeEnv, ctx);
    const isAuthRoute = path.startsWith("/api/auth/");
    const isPortalRoute = path.startsWith("/api/portal/");
    if (!authenticated && !isAuthRoute && !isPortalRoute) {
      return autoWorker.fetch(request, runtimeEnv, ctx);
    }

    if (path === "/api/payment-events" && method === "GET") {
      return json({ events: await listPaymentEvents(db, request) });
    }

    if (path === "/api/report-imports" && method === "GET") {
      return json({ imports: await listReportImports(db, request) });
    }

    if (path === "/api/automation-events" && method === "GET") {
      return json({ events: await listAutomationEvents(db, request) });
    }

    const paymentMatch = path.match(/^\/api\/removal-events\/(\d+)\/payment$/);
    if (paymentMatch && method === "POST") {
      return recordPayment(request, db, paymentMatch[1]);
    }

    const legacyBilling = path.match(/^\/api\/credit-items\/(\d+)\/billing-status$/);
    if (legacyBilling && method === "PUT") {
      const response = await autoWorker.fetch(request, runtimeEnv, ctx);
      return syncLegacyBillingChange(request, response, db, legacyBilling[1]);
    }

    return autoWorker.fetch(request, runtimeEnv, ctx);
  },
};
