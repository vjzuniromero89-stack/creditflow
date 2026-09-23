import { api } from "../api.js";
import { icon } from "../icons.js";
import { toast } from "../toast.js";
import { escapeHtml, todayLong } from "../utils.js";
import { renderTemplate, formatDobForLetter } from "./letters.js";
import { PROFESSIONAL_TEMPLATE_LIBRARY } from "./templates-pro.js";

const BUREAU_ADDRESS = {
  Equifax: "Equifax Information Services LLC\nP.O. Box 740256\nAtlanta, GA 30374",
  TransUnion: "TransUnion Consumer Solutions\nP.O. Box 2000\nChester, PA 19016-2000",
  Experian: "Experian\nDispute by Mail\nP.O. Box 4500\nAllen, TX 75013",
};

function normalize(s) {
  return String(s || "").trim().toLowerCase();
}

function bureauForItem(item) {
  const raw = String(item.bureaus || "");
  return ["Equifax", "TransUnion", "Experian"].find((b) => raw.toLowerCase().includes(b.toLowerCase())) || raw.split(",")[0]?.trim() || "";
}

function daysSince(value) {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : null;
}

function explicitIdentityTheft(notes) {
  return /(identity\s*theft\s*(confirmed|report|ftc)|robo\s+de\s+identidad\s+confirmado|fraud\s+confirmed)/i.test(notes || "");
}

function explicitUnauthorized(notes) {
  return /(unauthori[sz]ed|not\s+authorized|did\s+not\s+authorize|no\s+autoric[ée]|no\s+reconozco|not\s+mine)/i.test(notes || "");
}

function factualBasis(notes) {
  const n = String(notes || "").trim();
  if (n.length < 12) return false;
  return /(balance|saldo|status|estatus|late|payment|pago|date|fecha|opened|closed|duplicate|duplicad|not mine|no reconozco|authorized user|ownership|liability|account number|cuenta|settled|paid|pagad|incorrect|inaccurate|wrong|error|first delinquency|delinquency)/i.test(n);
}

function accurateNegative(notes) {
  return /(accurate|correct|information is correct|late was mine|goodwill|informaci[oó]n correcta|atraso correcto)/i.test(notes || "");
}

function newEvidence(notes) {
  return /(new evidence|nueva evidencia|new document|nuevo documento|additional evidence)/i.test(notes || "");
}

function verifiedResult(notes) {
  return /(verified|verificado|verified as accurate|investigation result)/i.test(notes || "");
}

function templateCode(name) {
  const m = String(name || "").match(/\[PRO\]\s*(\d+)/i);
  return m ? m[1] : "";
}

function findTemplate(templates, code) {
  return (templates || []).find((t) => templateCode(t.name) === String(code));
}

function existingFor(item, letters, code) {
  return (letters || []).find(
    (l) =>
      String(l.credit_item_id || "") === String(item.id || "") &&
      templateCode(l.template_name || l.title) === String(code)
  );
}

function latestLetterFor(item, letters) {
  const rows = (letters || []).filter((l) => String(l.credit_item_id || "") === String(item.id || ""));
  return rows.sort((a,b)=>new Date(b.updated_at||0)-new Date(a.updated_at||0))[0] || null;
}

function planItem(item, ctx) {
  if (item.removed_status === "eliminado") {
    return { state: "done", code: null, label: "Ya removido", reason: "No se debe seguir disputando." };
  }

  const reappeared = (ctx.removalEvents || []).find(
    (ev) => String(ev.credit_item_id) === String(item.id) && ev.status === "reappeared"
  );
  if (reappeared) {
    return { state: "ready", code: "32", label: "Reinsertion Challenge", reason: "CreditFlow registró una remoción previa y el ítem volvió a aparecer." };
  }

  const latest = latestLetterFor(item, ctx.letters);
  if (latest && ["borrador","lista","enviada","en_transito"].includes(latest.status)) {
    return { state: "waiting", code: null, label: "Hay una carta en proceso", reason: `Estado actual: ${latest.status}. No crear otra disputa encima.` };
  }

  if (latest?.status === "entregada") {
    const mailing = (ctx.mailings || []).find((m) => String(m.letter_id) === String(latest.id));
    const age = daysSince(mailing?.delivered_at || mailing?.mailed_at || latest.updated_at);
    if (age !== null && age < 30) {
      return { state: "waiting", code: null, label: `Esperar investigación (${30-age} días aprox.)`, reason: "La carta ya fue entregada; primero debe terminar el ciclo actual." };
    }
    return { state: "review", code: null, label: "Revisar respuesta / reporte actualizado", reason: "No se debe generar una segunda ronda sin conocer el resultado." };
  }

  const notes = item.notes || "";

  if (explicitIdentityTheft(notes)) {
    return { state: "review", code: "12", label: "Ruta Identity Theft §605B", reason: "Requiere confirmar Identity Theft Report y documentación antes de crear el bloque." };
  }

  if (newEvidence(notes) && latest) {
    return { state: "review", code: "30", label: "Follow-up con nueva evidencia", reason: "Existe nueva información; revisar que realmente no haya sido enviada antes." };
  }

  if (verifiedResult(notes) && latest) {
    return { state: "review", code: "31", label: "Procedure Description Request", reason: "El ítem figura como verificado; revisar resultado antes de pedir el procedimiento." };
  }

  if (item.category === "inquiry") {
    if (explicitUnauthorized(notes)) {
      return { state: "ready", code: "11", label: "Unauthorized Inquiry Dispute", reason: "Las notas indican expresamente que el consumidor no reconoce/autoriza la inquiry." };
    }
    return { state: "review", code: "11", label: "Confirmar autorización de inquiry", reason: "No debe disputarse automáticamente una inquiry sin confirmar que fue no autorizada." };
  }

  if (item.category === "pago_tardio" && accurateNegative(notes)) {
    return { state: "review", code: "40", label: "Goodwill Adjustment", reason: "Si el atraso es correcto, la vía adecuada es una solicitud voluntaria, no una disputa de exactitud." };
  }

  if (item.category === "liquidada" && /(paid|pagad|settled|liquidada|balance|saldo|status|estatus)/i.test(notes)) {
    return { state: "review", code: "41", label: "Post-payment / Settlement Correction", reason: "Revisar evidencia de pago/settlement y el balance/estatus reportado." };
  }

  if (factualBasis(notes)) {
    return { state: "ready", code: "10", label: "CRA Factual Dispute — Initial", reason: "Las notas contienen una base factual específica para investigar." };
  }

  if (item.category === "coleccion") {
    return { state: "review", code: "20", label: "Definir base de disputa + revisar Debt Validation", reason: "Una collection puede requerir disputa CRA, validación con collector, o ambas; primero documenta el error y el timing." };
  }

  return { state: "review", code: "10", label: "Documentar error específico", reason: "Falta una base factual concreta. CreditFlow no generará una carta genérica solo porque el ítem sea negativo." };
}

async function loadContext(clientId) {
  const [clientData, itemsData, templatesData, lettersData, mailingsData, docsData] = await Promise.all([
    api.get(`/clients/${clientId}`),
    api.get(`/credit-items?client_id=${clientId}`),
    api.get("/templates"),
    api.get(`/letters?client_id=${clientId}`),
    api.get("/mailings"),
    api.get(`/clients/${clientId}/documents`),
  ]);

  let removalEvents = [];
  try {
    const r = await api.get(`/removal-events?client_id=${clientId}`);
    removalEvents = r.events || [];
  } catch {}

  return {
    client: clientData.client,
    items: itemsData.credit_items || [],
    templates: templatesData.templates || [],
    letters: lettersData.letters || clientData.letters || [],
    mailings: mailingsData.mailings || [],
    documents: docsData.documents || [],
    removalEvents,
  };
}

export async function analyzeProfessionalStrategy(clientId) {
  const ctx = await loadContext(clientId);
  const docs = Object.fromEntries(ctx.documents.map((d)=>[d.doc_type,d]));
  const missingProfile = [];
  ["full_name","address","city","state","zip","date_of_birth"].forEach((k)=>{ if(!ctx.client[k]) missingProfile.push(k); });

  const libraryInstalled = PROFESSIONAL_TEMPLATE_LIBRARY.filter((p)=>findTemplate(ctx.templates,p.code)).length;

  const itemPlans = ctx.items.map((item)=>({
    item,
    ...planItem(item,ctx),
  }));

  const summary = {
    active: ctx.items.filter((i)=>i.removed_status!=="eliminado").length,
    removed: ctx.items.filter((i)=>i.removed_status==="eliminado").length,
    ready: itemPlans.filter((p)=>p.state==="ready").length,
    review: itemPlans.filter((p)=>p.state==="review").length,
    waiting: itemPlans.filter((p)=>p.state==="waiting").length,
  };

  return { ...ctx, docs, missingProfile, libraryInstalled, itemPlans, summary };
}

function mapFor(client,item,bureau) {
  return {
    cliente_nombre: client.full_name || "",
    cliente_direccion: client.address || "",
    cliente_ciudad_estado_zip: [client.city,client.state,client.zip].filter(Boolean).join(", "),
    cliente_id_last4: client.id_last4 || "",
    cliente_fecha_nacimiento: formatDobForLetter(client.date_of_birth),
    fecha: todayLong(),
    destinatario_nombre: bureau || "",
    destinatario_direccion: BUREAU_ADDRESS[bureau] || "",
    numero_cuenta: item.account_number || "",
    acreedor_nombre: item.creditor_name || "",
    motivo_disputa: item.notes || "",
    ronda: "1",
  };
}

export async function runProfessionalStrategyForClient(clientId, onDone) {
  const analysis = await analyzeProfessionalStrategy(clientId);

  if (analysis.missingProfile.length) {
    toast("Completa los datos de identidad del cliente antes de preparar disputas.", "error");
    return { created: 0, blocked: true };
  }

  if (analysis.libraryInstalled < PROFESSIONAL_TEMPLATE_LIBRARY.length) {
    toast("Primero instala la Biblioteca Profesional desde Plantillas.", "error");
    return { created: 0, blocked: true };
  }

  let created = 0;
  let skipped = 0;

  for (const p of analysis.itemPlans.filter((x)=>x.state==="ready")) {
    const template = findTemplate(analysis.templates,p.code);
    if (!template) { skipped++; continue; }
    if (existingFor(p.item, analysis.letters, p.code)) { skipped++; continue; }

    const bureau = bureauForItem(p.item);
    const map = mapFor(analysis.client,p.item,bureau);
    const body = renderTemplate(template.body,map);

    await api.post("/letters", {
      client_id: clientId,
      template_id: template.id,
      credit_item_id: p.item.id,
      title: `${template.name} — ${p.item.creditor_name || bureau || "ítem"}`,
      recipient_name: bureau || template.recipient_hint || "",
      recipient_address: BUREAU_ADDRESS[bureau] || "",
      round_number: p.code === "32" ? 2 : 1,
      body,
    });
    created++;
  }

  if (created) toast(`${created} borrador(es) profesional(es) preparado(s)`, "success");
  if (!created) toast("No hay nuevas cartas seguras para generar automáticamente. Revisa los ítems marcados para revisión.", "error");
  await onDone?.();
  return { created, skipped };
}

export async function renderProfessionalStrategyPanel(container, clientId) {
  container.innerHTML = `<div class="card">Analizando estrategia profesional…</div>`;
  try {
    const a = await analyzeProfessionalStrategy(clientId);
    const profileOk = !a.missingProfile.length;
    const docsOk = !!a.docs.id && !!a.docs.proof_address;

    container.innerHTML = `
      <section class="pro-client-strategy">
        <div class="pro-client-strategy-head">
          <div>
            <div class="pro-eyebrow">Professional Strategy Engine</div>
            <h2>Plan de acción del expediente</h2>
            <p>CreditFlow analiza cada negativo antes de crear una carta. Los ítems sin base factual quedan para revisión, no se disputan automáticamente.</p>
          </div>
          <button class="btn btn-primary" id="pro-generate-safe">${icon("spark")} Preparar borradores seguros (${a.summary.ready})</button>
        </div>

        <div class="pro-preflight">
          <div class="${profileOk?"ok":"warn"}"><span>${profileOk?"✓":"!"}</span><strong>Identidad</strong><small>${profileOk?"Completa":"Faltan datos"}</small></div>
          <div class="${docsOk?"ok":"warn"}"><span>${docsOk?"✓":"!"}</span><strong>Documentos</strong><small>${docsOk?"ID + domicilio":"Revisar adjuntos"}</small></div>
          <div class="${a.libraryInstalled===PROFESSIONAL_TEMPLATE_LIBRARY.length?"ok":"warn"}"><span>${a.libraryInstalled===PROFESSIONAL_TEMPLATE_LIBRARY.length?"✓":"!"}</span><strong>Plantillas</strong><small>${a.libraryInstalled}/${PROFESSIONAL_TEMPLATE_LIBRARY.length}</small></div>
          <div class="ok"><span>${a.summary.active}</span><strong>Activos</strong><small>en reporte</small></div>
          <div class="ok"><span>${a.summary.removed}</span><strong>Removidos</strong><small>cerrados</small></div>
        </div>

        <div class="pro-plan-table">
          ${a.itemPlans.length ? a.itemPlans.map((p)=>`
            <div class="pro-plan-row state-${p.state}">
              <div class="pro-plan-account">
                <strong>${escapeHtml(p.item.creditor_name || "Ítem sin nombre")}</strong>
                <span>${escapeHtml(p.item.bureaus || "Buró no indicado")} · ${escapeHtml(p.item.category || "")}</span>
              </div>
              <div class="pro-plan-action">
                <span class="pro-state">${p.state==="ready"?"Borrador permitido":p.state==="review"?"Revisión requerida":p.state==="waiting"?"Esperar":"Cerrado"}</span>
                <strong>${escapeHtml(p.label)}</strong>
                <small>${escapeHtml(p.reason)}</small>
              </div>
            </div>
          `).join("") : `<div class="empty">No hay negativos importados todavía.</div>`}
        </div>
      </section>
    `;

    container.querySelector("#pro-generate-safe")?.addEventListener("click", async (e)=>{
      const btn=e.currentTarget;
      btn.disabled=true;
      const old=btn.innerHTML;
      btn.innerHTML=`${icon("spark")} Preparando…`;
      try {
        await runProfessionalStrategyForClient(clientId, ()=>renderProfessionalStrategyPanel(container,clientId));
      } finally {
        btn.disabled=false;
        btn.innerHTML=old;
      }
    });
  } catch (err) {
    container.innerHTML = `<div class="card"><div class="auth-error">No se pudo analizar la estrategia: ${escapeHtml(err.message)}</div></div>`;
  }
}
