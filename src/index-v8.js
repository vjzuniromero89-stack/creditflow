import v7Worker from "./index-v7.js";
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
  const resp = await v7Worker.fetch(probe, env, ctx);
  if (!resp.ok) return false;
  try {
    return !!(await resp.json()).authenticated;
  } catch {
    return false;
  }
}

async function preflight(db, clientId) {
  const client = await db.prepare(`
    SELECT id, full_name, email, phone, address, city, state, zip,
           date_of_birth, id_last4, status
    FROM clients WHERE id = ?
  `).bind(clientId).first();
  if (!client) return null;

  const { results: docs } = await db.prepare(`
    SELECT doc_type, file_name, updated_at
    FROM client_documents
    WHERE client_id = ?
  `).bind(clientId).all();

  const { results: items } = await db.prepare(`
    SELECT id, category, removed_status, is_disputed
    FROM credit_items
    WHERE client_id = ?
  `).bind(clientId).all();

  const { results: letters } = await db.prepare(`
    SELECT id, status, credit_item_id, title, recipient_name, recipient_address, updated_at
    FROM letters
    WHERE client_id = ?
  `).bind(clientId).all();

  const reportCount = await db.prepare(`
    SELECT COUNT(*) AS n FROM report_imports WHERE client_id = ?
  `).bind(clientId).first();

  const docsMap = Object.fromEntries((docs || []).map((d) => [d.doc_type, d]));
  const requiredProfile = ["full_name", "address", "city", "state", "zip", "date_of_birth"];
  const missingProfile = requiredProfile.filter((k) => !client[k]);

  const checks = [
    {
      key: "profile",
      label: "Información del cliente",
      ok: missingProfile.length === 0,
      detail: missingProfile.length ? `Falta: ${missingProfile.join(", ")}` : "Datos principales completos",
    },
    {
      key: "id",
      label: "Identificación",
      ok: !!docsMap.id,
      detail: docsMap.id ? docsMap.id.file_name || "ID cargado" : "Falta identificación",
    },
    {
      key: "proof_address",
      label: "Comprobante de domicilio",
      ok: !!docsMap.proof_address,
      detail: docsMap.proof_address ? docsMap.proof_address.file_name || "Comprobante cargado" : "Falta comprobante",
    },
    {
      key: "report",
      label: "Reporte de crédito",
      ok: Number(reportCount?.n || 0) > 0 || (items || []).length > 0,
      detail: `${items?.length || 0} ítem(s) detectado(s)`,
    },
  ];

  const activeItems = (items || []).filter((x) => x.removed_status !== "eliminado");
  const drafts = (letters || []).filter((x) => x.status === "borrador");
  const readyLetters = (letters || []).filter((x) => x.status === "lista");
  const mailedLetters = (letters || []).filter((x) => ["enviada", "en_transito", "entregada"].includes(x.status));

  return {
    client,
    checks,
    ready: checks.every((x) => x.ok),
    missing: checks.filter((x) => !x.ok),
    counts: {
      active_items: activeItems.length,
      total_items: items?.length || 0,
      draft_letters: drafts.length,
      ready_letters: readyLetters.length,
      mailed_letters: mailedLetters.length,
    },
  };
}

async function getCase(db, clientId) {
  return db.prepare(`
    SELECT * FROM repair_cases WHERE client_id = ? LIMIT 1
  `).bind(clientId).first();
}

async function caseEvents(db, caseId) {
  const { results } = await db.prepare(`
    SELECT * FROM repair_case_events
    WHERE repair_case_id = ?
    ORDER BY created_at DESC, id DESC
    LIMIT 200
  `).bind(caseId).all();
  return results || [];
}

async function mailJobs(db, clientId) {
  const { results } = await db.prepare(`
    SELECT cmj.*, l.title, l.recipient_name, l.recipient_address, l.status AS letter_status
    FROM certified_mail_jobs cmj
    JOIN letters l ON l.id = cmj.letter_id
    WHERE cmj.client_id = ?
    ORDER BY cmj.created_at DESC, cmj.id DESC
  `).bind(clientId).all();
  return results || [];
}

function providerStatus(env) {
  // No se inventa un contrato de API. Solo reportamos si las credenciales
  // acordadas con CertifiedMailLabels fueron configuradas posteriormente.
  const credentialsPresent = !!(env.CML_API_KEY && env.CML_API_BASE_URL);
  return {
    provider: "CertifiedMailLabels",
    credentials_present: credentialsPresent,
    integration_ready: false,
    status: credentialsPresent ? "credentials_present_needs_adapter" : "not_configured",
    note: credentialsPresent
      ? "Credenciales detectadas; falta implementar el contrato técnico exacto provisto por CertifiedMailLabels."
      : "Pendiente de credenciales y documentación técnica de CertifiedMailLabels.",
  };
}

async function logCaseEvent(db, repairCase, eventType, fromStage, toStage, detail, metadata = {}) {
  await db.prepare(`
    INSERT INTO repair_case_events
      (repair_case_id, client_id, event_type, from_stage, to_stage, detail, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    repairCase.id,
    repairCase.client_id,
    eventType,
    fromStage || null,
    toStage || null,
    detail || null,
    JSON.stringify(metadata || {})
  ).run();
}

async function setStage(db, repairCase, stage, nextAction, eventType, detail, metadata = {}) {
  const from = repairCase.current_stage;
  await db.prepare(`
    UPDATE repair_cases
    SET current_stage = ?, next_action = ?, updated_at = NOW()
    WHERE id = ?
  `).bind(stage, nextAction || null, repairCase.id).run();

  await logCaseEvent(db, repairCase, eventType, from, stage, detail, metadata);
  return getCase(db, repairCase.client_id);
}

async function startCase(request, db, clientId) {
  const pf = await preflight(db, clientId);
  if (!pf) return json({ error: "Cliente no encontrado." }, 404);

  let body = {};
  try { body = await request.json(); } catch {}
  const requestedMode = ["manual", "assisted", "automatic"].includes(body.automation_mode)
    ? body.automation_mode
    : "assisted";

  let repairCase = await getCase(db, clientId);
  if (!repairCase) {
    repairCase = await db.prepare(`
      INSERT INTO repair_cases
        (client_id, status, automation_mode, current_stage, next_action,
         approval_required, approved_for_auto_send, certified_mail_status)
      VALUES (?, 'active', ?, 'preflight', ?, TRUE, FALSE, 'not_configured')
      RETURNING *
    `).bind(
      clientId,
      requestedMode,
      pf.ready ? "Revisar información personal" : "Completar requisitos del expediente"
    ).first();

    await logCaseEvent(
      db,
      repairCase,
      "repair_started",
      null,
      "preflight",
      "Proceso de reparación iniciado.",
      { automation_mode: requestedMode }
    );
  }

  if (pf.ready && repairCase.current_stage === "preflight") {
    repairCase = await setStage(
      db,
      repairCase,
      "identity_review",
      "Revisar y confirmar información personal",
      "preflight_completed",
      "Preflight completado automáticamente."
    );
  }

  return json({
    case: repairCase,
    preflight: pf,
    provider: providerStatus({}),
  });
}

async function getCaseStatus(env, db, clientId) {
  const pf = await preflight(db, clientId);
  if (!pf) return null;
  const repairCase = await getCase(db, clientId);
  return {
    case: repairCase,
    preflight: pf,
    events: repairCase ? await caseEvents(db, repairCase.id) : [],
    mail_jobs: await mailJobs(db, clientId),
    provider: providerStatus(env),
  };
}

async function updateMode(request, db, clientId) {
  let body = {};
  try { body = await request.json(); } catch {}
  const mode = body.automation_mode;
  if (!["manual", "assisted", "automatic"].includes(mode)) {
    return json({ error: "Modo inválido." }, 400);
  }

  const repairCase = await getCase(db, clientId);
  if (!repairCase) return json({ error: "Primero inicia la reparación." }, 409);

  await db.prepare(`
    UPDATE repair_cases SET automation_mode = ?, updated_at = NOW() WHERE id = ?
  `).bind(mode, repairCase.id).run();

  await logCaseEvent(
    db, repairCase, "automation_mode_changed",
    repairCase.current_stage, repairCase.current_stage,
    `Modo cambiado a ${mode}.`, { automation_mode: mode }
  );

  return json({ case: await getCase(db, clientId) });
}

async function prepareMailJobs(db, repairCase) {
  const { results: letters } = await db.prepare(`
    SELECT id, client_id, title, recipient_name, recipient_address, status
    FROM letters
    WHERE client_id = ? AND status = 'lista'
    ORDER BY id
  `).bind(repairCase.client_id).all();

  let created = 0;
  for (const letter of letters || []) {
    const existing = await db.prepare(`
      SELECT id FROM certified_mail_jobs WHERE letter_id = ? LIMIT 1
    `).bind(letter.id).first();
    if (existing) continue;

    await db.prepare(`
      INSERT INTO certified_mail_jobs
        (repair_case_id, client_id, letter_id, status, payload_json)
      VALUES (?, ?, ?, 'awaiting_approval', ?)
    `).bind(
      repairCase.id,
      repairCase.client_id,
      letter.id,
      JSON.stringify({
        letter_id: letter.id,
        title: letter.title,
        recipient_name: letter.recipient_name,
        recipient_address: letter.recipient_address,
        internal_reference: `CF-${repairCase.client_id}-${letter.id}`,
      })
    ).run();
    created++;
  }
  return created;
}

async function applyAction(request, env, db, clientId) {
  const repairCase = await getCase(db, clientId);
  if (!repairCase) return json({ error: "Primero inicia la reparación." }, 409);

  let body = {};
  try { body = await request.json(); } catch {}
  const action = body.action;
  const pf = await preflight(db, clientId);

  if (action === "sync") {
    if (!pf.ready) {
      if (repairCase.current_stage !== "preflight") {
        const updated = await setStage(
          db, repairCase, "preflight", "Completar requisitos del expediente",
          "preflight_reopened", "Faltan requisitos obligatorios."
        );
        return json({ case: updated, preflight: pf });
      }
      return json({ case: repairCase, preflight: pf });
    }
    if (repairCase.current_stage === "preflight") {
      const updated = await setStage(
        db, repairCase, "identity_review", "Revisar y confirmar información personal",
        "preflight_completed", "Todos los requisitos mínimos están completos."
      );
      return json({ case: updated, preflight: pf });
    }
    return json({ case: repairCase, preflight: pf });
  }

  if (action === "complete_identity_review") {
    if (!pf.ready) return json({ error: "Completa primero el preflight." }, 409);
    const updated = await setStage(
      db, repairCase, "report_audit", "Revisar negativos y confirmar auditoría",
      "identity_review_completed",
      "Información personal marcada como revisada."
    );
    return json({ case: updated });
  }

  if (action === "complete_report_audit") {
    if (!pf.counts.active_items) {
      return json({ error: "No hay negativos activos para auditar." }, 409);
    }
    const updated = await setStage(
      db, repairCase, "strategy_ready", "Generar estrategia y borradores",
      "report_audit_completed",
      "Auditoría del reporte marcada como completa.",
      { active_items: pf.counts.active_items }
    );
    return json({ case: updated });
  }

  if (action === "strategy_generated") {
    const nextPf = await preflight(db, clientId);
    const updated = await setStage(
      db, repairCase,
      nextPf.counts.draft_letters ? "approval_required" : "strategy_ready",
      nextPf.counts.draft_letters ? "Revisar y aprobar borradores" : "Revisar estrategia: no se generaron borradores",
      "strategy_generated",
      `${nextPf.counts.draft_letters} borrador(es) disponible(s).`,
      { draft_letters: nextPf.counts.draft_letters }
    );
    await db.prepare(`
      UPDATE repair_cases SET last_strategy_at = NOW() WHERE id = ?
    `).bind(repairCase.id).run();
    return json({ case: updated, preflight: nextPf });
  }

  if (action === "approve_letters") {
    const { results: drafts } = await db.prepare(`
      SELECT id FROM letters WHERE client_id = ? AND status = 'borrador'
    `).bind(clientId).all();
    if (!drafts?.length) return json({ error: "No hay borradores pendientes de aprobación." }, 409);

    await db.prepare(`
      UPDATE letters
      SET status = 'lista', updated_at = datetime('now')
      WHERE client_id = ? AND status = 'borrador'
    `).bind(clientId).run();

    const created = await prepareMailJobs(db, repairCase);
    const updated = await setStage(
      db, repairCase, "mailing_ready", "Aprobar lote de Certified Mail",
      "letters_approved",
      `${drafts.length} carta(s) aprobada(s); ${created} trabajo(s) de correo preparado(s).`,
      { approved_letters: drafts.length, mail_jobs_created: created }
    );
    return json({ case: updated, jobs: await mailJobs(db, clientId) });
  }

  if (action === "approve_mailing") {
    const { results: jobs } = await db.prepare(`
      SELECT id FROM certified_mail_jobs
      WHERE client_id = ? AND status = 'awaiting_approval'
    `).bind(clientId).all();
    if (!jobs?.length) return json({ error: "No hay envíos esperando aprobación." }, 409);

    await db.prepare(`
      UPDATE certified_mail_jobs
      SET status = 'approved_waiting_provider', approved_at = NOW(), updated_at = NOW()
      WHERE client_id = ? AND status = 'awaiting_approval'
    `).bind(clientId).run();

    const provider = providerStatus(env);
    const updated = await setStage(
      db, repairCase,
      "provider_setup",
      provider.integration_ready
        ? "Enviar lote a CertifiedMailLabels"
        : "Conectar CertifiedMailLabels para habilitar envío automático",
      "mailing_approved",
      `${jobs.length} envío(s) aprobado(s).`,
      { provider_status: provider.status }
    );
    return json({ case: updated, provider, jobs: await mailJobs(db, clientId) });
  }

  if (action === "mark_waiting_response") {
    const updated = await setStage(
      db, repairCase, "waiting_response", "Esperar respuesta / nuevo reporte",
      "mailing_cycle_started", "Caso marcado como esperando respuesta."
    );
    return json({ case: updated });
  }

  if (action === "new_report_due") {
    const updated = await setStage(
      db, repairCase, "new_report_due", "Importar reporte actualizado",
      "new_report_requested", "Se requiere un nuevo reporte para medir resultados."
    );
    return json({ case: updated });
  }

  if (action === "results_review") {
    const updated = await setStage(
      db, repairCase, "results_review", "Revisar remociones y cuentas que siguen reportando",
      "results_review_started", "Comenzó la revisión de resultados."
    );
    return json({ case: updated });
  }

  if (action === "complete_case") {
    await db.prepare(`
      UPDATE repair_cases
      SET status = 'completed', current_stage = 'completed',
          next_action = 'Caso completado', completed_at = NOW(), updated_at = NOW()
      WHERE id = ?
    `).bind(repairCase.id).run();
    await logCaseEvent(
      db, repairCase, "case_completed",
      repairCase.current_stage, "completed", "Caso marcado como completado."
    );
    return json({ case: await getCase(db, clientId) });
  }

  if (action === "pause") {
    const reason = String(body.reason || "Pausado manualmente").slice(0, 500);
    await db.prepare(`
      UPDATE repair_cases SET status='paused', paused_reason=?, updated_at=NOW() WHERE id=?
    `).bind(reason, repairCase.id).run();
    await logCaseEvent(db, repairCase, "case_paused", repairCase.current_stage, repairCase.current_stage, reason);
    return json({ case: await getCase(db, clientId) });
  }

  if (action === "resume") {
    await db.prepare(`
      UPDATE repair_cases SET status='active', paused_reason=NULL, updated_at=NOW() WHERE id=?
    `).bind(repairCase.id).run();
    await logCaseEvent(db, repairCase, "case_resumed", repairCase.current_stage, repairCase.current_stage, "Caso reanudado.");
    return json({ case: await getCase(db, clientId) });
  }

  return json({ error: "Acción no reconocida." }, 400);
}

export default {
  async fetch(request, env, ctx) {
    const runtimeEnv = { ...env, DB: createD1Shim(env) };
    const db = runtimeEnv.DB;
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method.toUpperCase();

    if (!path.startsWith("/api/")) {
      return v7Worker.fetch(request, runtimeEnv, ctx);
    }

    const authenticated = await authOk(request, runtimeEnv, ctx);
    const isAuthRoute = path.startsWith("/api/auth/");
    const isPortalRoute = path.startsWith("/api/portal/");
    if (!authenticated && !isAuthRoute && !isPortalRoute) {
      return v7Worker.fetch(request, runtimeEnv, ctx);
    }

    const caseMatch = path.match(/^\/api\/repair-cases\/(\d+)$/);
    if (caseMatch && method === "GET") {
      const data = await getCaseStatus(runtimeEnv, db, caseMatch[1]);
      if (!data) return json({ error: "Cliente no encontrado." }, 404);
      return json(data);
    }

    const startMatch = path.match(/^\/api\/repair-cases\/(\d+)\/start$/);
    if (startMatch && method === "POST") {
      return startCase(request, db, startMatch[1]);
    }

    const modeMatch = path.match(/^\/api\/repair-cases\/(\d+)\/mode$/);
    if (modeMatch && method === "PUT") {
      return updateMode(request, db, modeMatch[1]);
    }

    const actionMatch = path.match(/^\/api\/repair-cases\/(\d+)\/action$/);
    if (actionMatch && method === "POST") {
      return applyAction(request, runtimeEnv, db, actionMatch[1]);
    }

    return v7Worker.fetch(request, runtimeEnv, ctx);
  },
};
