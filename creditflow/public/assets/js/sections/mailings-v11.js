import { api } from "../api.js";
import { toast } from "../toast.js";
import { escapeHtml, formatDateTime } from "../utils.js";

const badge=(t,k="neutral")=>`<span class="pg11-badge ${k}">${escapeHtml(t||"—")}</span>`;
const kind=s=>/connected|success|processed|delivered|ready/i.test(s||"")?"good":/error|failed|returned/i.test(s||"")?"bad":/submitted|printing|progress/i.test(s||"")?"warn":"neutral";

function groupCard(g){
  const titles=(g.letters||[]).map(x=>`<li>${escapeHtml(x.title||`Carta #${x.id}`)}</li>`).join("");
  return `<article class="card" style="padding:18px;display:grid;gap:12px">
    <div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap">
      <div>
        <div class="pg11-kicker">PAQUETE · RONDA ${g.round_number||1}</div>
        <h3 style="margin:4px 0">${escapeHtml(g.recipient_name||"Destinatario")}</h3>
        <p style="margin:0;color:var(--cf7-muted)">${escapeHtml(g.client_name||"")} · <strong>${g.letter_count} carta(s)</strong></p>
        <small style="display:block;margin-top:5px">${escapeHtml(g.recipient_address||"")}</small>
      </div>
      <div style="min-width:280px;display:flex;gap:8px;align-items:center">
        <select data-group-service="${escapeHtml(g.group_key)}" style="flex:1">
          <option value="certified_return_receipt">Certified + Return Receipt</option>
          <option value="certified">Certified Mail</option>
        </select>
        <button class="btn btn-primary" data-prepare-group="${escapeHtml(g.group_key)}">Preparar paquete</button>
      </div>
    </div>
    <details>
      <summary style="cursor:pointer">${g.letter_count} cartas dentro de este mismo sobre certificado</summary>
      <ul style="margin:10px 0 0 20px">${titles}</ul>
    </details>
  </article>`;
}

export async function renderMailingsV11(container){
  container.innerHTML=`<div class="pg11-loading">Cargando PostGrid…</div>`;

  let legacy,pack;
  try{
    [legacy,pack]=await Promise.all([
      api.get("/postgrid/status"),
      api.get("/postgrid/package-status")
    ]);
  }catch(e){
    container.innerHTML=`<div class="card"><div class="auth-error">No se pudo cargar PostGrid: ${escapeHtml(e.message)}</div></div>`;
    return;
  }

  const p=legacy.provider||{},groups=pack.groups||[],packages=pack.packages||[];
  const totalLetters=pack.ready_letters_count||0;
  const prepared=packages.filter(x=>x.status==="prepared_test").length;
  const submitted=packages.filter(x=>x.provider_job_id).length;
  const tracked=packages.filter(x=>x.tracking_number).length;

  container.innerHTML=`
  <section class="cf7-page-hero pg11-hero">
    <div>
      <div class="cf7-eyebrow">POSTGRID CONNECTOR · GROUPED MAIL v13.5.6</div>
      <h2>Envíos certificados</h2>
      <p>CreditFlow agrupa todas las cartas del <strong>mismo cliente + destinatario + ronda</strong> dentro de un solo sobre certificado.</p>
    </div>
    <div class="pg11-env">TEST SANDBOX</div>
  </section>

  <section class="pg11-provider card">
    <div class="pg11-provider-main">
      <div class="pg11-logo">PG</div>
      <div><div class="pg11-kicker">Proveedor activo</div><h3>PostGrid Print & Mail API</h3>
      <p>Clave: ${p.credentials_configured?"configurada en Cloudflare":"no detectada"} · modo TEST.</p></div>
    </div>
    <div class="pg11-provider-actions">
      ${badge(p.connection_status||"sin probar",kind(p.connection_status))}
      <button class="btn btn-primary" id="pg11-test">Probar conexión</button>
    </div>
  </section>

  <div class="pg11-kpis">
    <div class="card"><span>${totalLetters}</span><strong>Cartas listas</strong><small>documentos individuales</small></div>
    <div class="card"><span>${groups.length}</span><strong>Paquetes por preparar</strong><small>un certified por destinatario</small></div>
    <div class="card"><span>${prepared}</span><strong>Paquetes preparados</strong><small>listos para sandbox</small></div>
    <div class="card"><span>${submitted}</span><strong>En PostGrid TEST</strong><small>${tracked} con tracking</small></div>
  </div>

  <section class="card pg11-section">
    <div class="pg11-section-head">
      <div><div class="pg11-kicker">PASO 1</div><h3>Paquetes certificados agrupados</h3>
      <p>Varias cartas al mismo buró viajan juntas. Ejemplo: 7 cartas a TransUnion = 1 Certified Mail.</p></div>
      ${groups.length>1?`<button class="btn btn-primary" id="pg11-prepare-all">Preparar los ${groups.length} paquetes</button>`:""}
    </div>
    <div id="pg11-groups" style="display:grid;gap:12px"></div>
  </section>

  <section class="card pg11-section">
    <div class="pg11-section-head">
      <div><div class="pg11-kicker">PASO 2</div><h3>Cola de paquetes PostGrid</h3>
      <p>Cada fila representa <strong>un solo sobre certificado</strong>, aunque contenga varias cartas.</p></div>
    </div>
    <div id="pg11-packages"></div>
  </section>

  <section class="pg11-safety">
    <strong>Ahorro activo:</strong> CreditFlow no crea un Certified Mail por cada carta. Agrupa por cliente, destinatario y ronda.
    En esta versión PostGrid continúa en TEST y no envía correo físico.
  </section>`;

  const gb=document.getElementById("pg11-groups");
  gb.innerHTML=groups.length?groups.map(groupCard).join(""):`<div class="empty text-sm">No hay cartas pendientes de agrupar.</div>`;

  const findGroup=key=>groups.find(g=>g.group_key===key);
  gb.querySelectorAll("[data-prepare-group]").forEach(b=>b.onclick=async()=>{
    const key=b.dataset.prepareGroup,g=findGroup(key);
    if(!g)return;
    const select=gb.querySelector(`[data-group-service="${CSS.escape(key)}"]`);
    b.disabled=true;b.textContent="Preparando…";
    try{
      await api.post("/postgrid/packages/prepare",{letter_ids:g.letter_ids,mailing_class:select?.value||"certified_return_receipt"});
      toast(`${g.letter_count} cartas agrupadas en 1 paquete para ${g.recipient_name}`,"success");
      await renderMailingsV11(container);
    }catch(e){toast(e.detail||e.message,"error");b.disabled=false;b.textContent="Preparar paquete"}
  });

  document.getElementById("pg11-prepare-all")?.addEventListener("click",async e=>{
    const b=e.currentTarget;
    if(!confirm(`Se crearán ${groups.length} paquetes certificados para ${totalLetters} cartas. ¿Continuar?`))return;
    b.disabled=true;b.textContent="Preparando paquetes…";
    try{
      let made=0;
      for(const g of groups){
        await api.post("/postgrid/packages/prepare",{letter_ids:g.letter_ids,mailing_class:"certified_return_receipt"});
        made++;
      }
      toast(`${made} paquete(s) preparados para ${totalLetters} cartas`,"success");
      await renderMailingsV11(container);
    }catch(err){toast(err.detail||err.message,"error");b.disabled=false;b.textContent=`Preparar los ${groups.length} paquetes`}
  });

  const pb=document.getElementById("pg11-packages");
  pb.innerHTML=packages.length?`<div class="pg11-table"><table>
    <thead><tr><th>Paquete</th><th>Cliente / destinatario</th><th>Cartas</th><th>Estado</th><th>Tracking</th><th></th></tr></thead>
    <tbody>${packages.map(x=>`<tr>
      <td><code>${escapeHtml(x.internal_reference||`CFP-${x.id}`)}</code><small>Ronda ${x.round_number||1}</small></td>
      <td><strong>${escapeHtml(x.client_name||"—")}</strong><small>→ ${escapeHtml(x.recipient_name||"—")}</small></td>
      <td><strong>${x.letter_count||0}</strong><small>1 solo sobre</small></td>
      <td>${badge(x.status,kind(x.status))}<small>${escapeHtml(x.mailing_class||"certified")}</small></td>
      <td>${x.tracking_number?`<code>${escapeHtml(x.tracking_number)}</code>`:"—"}</td>
      <td class="pg11-actions">
        ${!x.provider_job_id
          ?`<button class="btn btn-primary btn-sm" data-submit-package="${x.id}">Enviar a TEST</button>`
          :`<button class="btn btn-ghost btn-sm" data-sync-package="${x.id}">Sincronizar</button>`}
      </td>
    </tr>`).join("")}</tbody></table></div>`:`<div class="empty text-sm">Todavía no hay paquetes preparados.</div>`;

  pb.querySelectorAll("[data-submit-package]").forEach(b=>b.onclick=async()=>{
    const pkg=packages.find(x=>String(x.id)===String(b.dataset.submitPackage));
    if(!confirm(`Esto creará UNA orden TEST para ${pkg?.letter_count||0} cartas agrupadas. No se enviará correo físico. ¿Continuar?`))return;
    b.disabled=true;b.textContent="Enviando…";
    try{
      const r=await api.post(`/postgrid/packages/${b.dataset.submitPackage}/submit`,{});
      toast(`1 orden PostGrid TEST creada para ${r.letter_count||pkg?.letter_count||0} cartas`,"success");
      await renderMailingsV11(container);
    }catch(e){toast(e.detail||e.message,"error");b.disabled=false;b.textContent="Enviar a TEST"}
  });

  pb.querySelectorAll("[data-sync-package]").forEach(b=>b.onclick=async()=>{
    b.disabled=true;b.textContent="Sincronizando…";
    try{
      await api.post(`/postgrid/packages/${b.dataset.syncPackage}/sync`,{});
      toast("Estado del paquete actualizado","success");
      await renderMailingsV11(container);
    }catch(e){toast(e.detail||e.message,"error");b.disabled=false;b.textContent="Sincronizar"}
  });

  document.getElementById("pg11-test").onclick=async()=>{
    const b=document.getElementById("pg11-test");
    b.disabled=true;b.textContent="Probando…";
    try{
      const r=await api.post("/postgrid/test",{});
      toast(r.message||"Conexión correcta","success");
      await renderMailingsV11(container);
    }catch(e){toast(e.message,"error");b.disabled=false;b.textContent="Probar conexión"}
  };
}
