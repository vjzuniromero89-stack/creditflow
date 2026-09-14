import { api } from "../api.js";
import { toast } from "../toast.js";
import { escapeHtml } from "../utils.js";

const badge=(t,k="neutral")=>`<span class="pg11-badge ${k}">${escapeHtml(t||"—")}</span>`;
const kind=s=>/connected|success|processed|delivered|ready/i.test(s||"")?"good":/error|failed|returned/i.test(s||"")?"bad":/submitted|printing|progress/i.test(s||"")?"warn":"neutral";

function certifiedCard(g){
  return `<article class="card" style="padding:18px;display:grid;gap:10px">
    <div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap">
      <div><div class="pg11-kicker">CERTIFIED · RONDA ${g.round_number||1}</div>
      <h3 style="margin:4px 0">${escapeHtml(g.recipient_name||"Buró")}</h3>
      <p style="margin:0">${escapeHtml(g.client_name||"")} · <strong>${g.letter_count} carta(s) en 1 sobre</strong></p>
      <small>${escapeHtml(g.recipient_address||"")}</small></div>
      <button class="btn btn-primary" data-prepare-group="${escapeHtml(g.group_key)}">Preparar Certified</button>
    </div>
  </article>`;
}
function stampCard(g){
  return `<article class="card" style="padding:18px;display:grid;gap:10px">
    <div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start;flex-wrap:wrap">
      <div><div class="pg11-kicker">STAMP · CORREO NORMAL · RONDA ${g.round_number||1}</div>
      <h3 style="margin:4px 0">${escapeHtml(g.recipient_name||"Acreedor / Collector")}</h3>
      <p style="margin:0">${escapeHtml(g.client_name||"")} · <strong>${g.letter_count} carta(s) en 1 sobre</strong></p>
      <small>${escapeHtml(g.recipient_address||"")}</small></div>
      <button class="btn btn-primary" data-stamp-mailed="${escapeHtml(g.group_key)}">Marcar enviado con stamp</button>
    </div>
    <details><summary>Ver cartas</summary><ul>${(g.letters||[]).map(x=>`<li>${escapeHtml(x.title||`Carta #${x.id}`)}</li>`).join("")}</ul></details>
  </article>`;
}

export async function renderMailingsV11(container){
  container.innerHTML=`<div class="pg11-loading">Cargando envíos…</div>`;
  let legacy,pack;
  try{
    [legacy,pack]=await Promise.all([api.get("/postgrid/status"),api.get("/postgrid/package-status")]);
  }catch(e){
    container.innerHTML=`<div class="card"><div class="auth-error">No se pudieron cargar los envíos: ${escapeHtml(e.message)}</div></div>`;return;
  }

  const p=legacy.provider||{},groups=pack.groups||[],stampGroups=pack.stamp_groups||[],packages=pack.packages||[];
  container.innerHTML=`
  <section class="cf7-page-hero pg11-hero">
    <div><div class="cf7-eyebrow">SMART MAIL ROUTER · v13.6.2</div>
    <h2>Envíos</h2>
    <p><strong>Burós:</strong> PostGrid Certified. <strong>Acreedores / collectors:</strong> imprimir y enviar con stamp normal.</p></div>
    <div class="pg11-env">POSTGRID TEST</div>
  </section>

  <div class="pg11-kpis">
    <div class="card"><span>${pack.certified_letters_count||0}</span><strong>Cartas a burós</strong><small>Certified</small></div>
    <div class="card"><span>${groups.length}</span><strong>Certified por preparar</strong><small>agrupados por buró</small></div>
    <div class="card"><span>${pack.stamp_letters_count||0}</span><strong>Cartas directas</strong><small>con stamp</small></div>
    <div class="card"><span>${stampGroups.length}</span><strong>Sobres con stamp</strong><small>sin PostGrid</small></div>
  </div>

  <section class="card pg11-section">
    <div class="pg11-section-head"><div><div class="pg11-kicker">COLA A · BURÓS</div>
    <h3>Certified Mail</h3><p>Experian, Equifax y TransUnion. Varias cartas al mismo buró se agrupan en un solo Certified.</p></div></div>
    <div id="pg11-certified" style="display:grid;gap:12px"></div>
  </section>

  <section class="card pg11-section">
    <div class="pg11-section-head"><div><div class="pg11-kicker">COLA B · ACREEDORES / COLLECTORS</div>
    <h3>Correo normal con stamp</h3><p>Estas cartas <strong>no entran a PostGrid</strong>. Se imprimen, se colocan en sobre y se envían con estampilla normal.</p></div></div>
    <div id="pg11-stamps" style="display:grid;gap:12px"></div>
  </section>

  <section class="card pg11-section">
    <div class="pg11-section-head"><div><div class="pg11-kicker">POSTGRID TEST</div><h3>Paquetes certificados preparados</h3></div>
    <button class="btn btn-primary" id="pg11-test">Probar conexión</button></div>
    <div id="pg11-packages"></div>
  </section>

  <section class="pg11-safety"><strong>Protección de costo:</strong> el backend bloquea las cartas directas de acreedores/collectors para que no puedan convertirse accidentalmente en una orden PostGrid.</section>`;

  const cb=document.getElementById("pg11-certified");
  cb.innerHTML=groups.length?groups.map(certifiedCard).join(""):`<div class="empty text-sm">No hay Certified pendientes.</div>`;
  cb.querySelectorAll("[data-prepare-group]").forEach(b=>b.onclick=async()=>{
    const g=groups.find(x=>x.group_key===b.dataset.prepareGroup);if(!g)return;
    b.disabled=true;b.textContent="Preparando…";
    try{
      await api.post("/postgrid/packages/prepare",{letter_ids:g.letter_ids,mailing_class:"certified_return_receipt"});
      toast(`${g.letter_count} carta(s) agrupadas en 1 Certified para ${g.recipient_name}`,"success");
      await renderMailingsV11(container);
    }catch(e){toast(e.detail||e.message,"error");b.disabled=false;b.textContent="Preparar Certified"}
  });

  const sb=document.getElementById("pg11-stamps");
  sb.innerHTML=stampGroups.length?stampGroups.map(stampCard).join(""):`<div class="empty text-sm">No hay sobres con stamp pendientes.</div>`;
  sb.querySelectorAll("[data-stamp-mailed]").forEach(b=>b.onclick=async()=>{
    const g=stampGroups.find(x=>x.group_key===b.dataset.stampMailed);if(!g)return;
    if(!confirm(`Confirma que imprimiste y enviaste ${g.letter_count} carta(s) a ${g.recipient_name} usando correo normal con stamp.`))return;
    b.disabled=true;b.textContent="Guardando…";
    try{
      await api.post("/stamp-mail/mark-mailed",{letter_ids:g.letter_ids});
      toast(`${g.letter_count} carta(s) marcadas como enviadas con stamp`,"success");
      await renderMailingsV11(container);
    }catch(e){toast(e.detail||e.message,"error");b.disabled=false;b.textContent="Marcar enviado con stamp"}
  });

  const pb=document.getElementById("pg11-packages");
  pb.innerHTML=packages.length?`<div class="pg11-table"><table><thead><tr><th>Paquete</th><th>Destinatario</th><th>Cartas</th><th>Estado</th><th>Tracking</th><th></th></tr></thead>
  <tbody>${packages.map(x=>`<tr><td><code>${escapeHtml(x.internal_reference||`CFP-${x.id}`)}</code></td>
  <td>${escapeHtml(x.recipient_name||"—")}</td><td>${x.letter_count||0}</td><td>${badge(x.status,kind(x.status))}</td>
  <td>${x.tracking_number?`<code>${escapeHtml(x.tracking_number)}</code>`:"—"}</td>
  <td>${!x.provider_job_id?`<button class="btn btn-primary btn-sm" data-submit-package="${x.id}">Enviar a TEST</button>`:`<button class="btn btn-ghost btn-sm" data-sync-package="${x.id}">Sincronizar</button>`}</td></tr>`).join("")}</tbody></table></div>`:`<div class="empty text-sm">Todavía no hay paquetes Certified preparados.</div>`;

  pb.querySelectorAll("[data-submit-package]").forEach(b=>b.onclick=async()=>{
    const pkg=packages.find(x=>String(x.id)===String(b.dataset.submitPackage));
    if(!confirm(`Crear UNA orden PostGrid TEST para este paquete de ${pkg?.letter_count||0} carta(s). No se enviará correo físico.`))return;
    b.disabled=true;b.textContent="Enviando…";
    try{await api.post(`/postgrid/packages/${b.dataset.submitPackage}/submit`,{});toast("Orden TEST creada","success");await renderMailingsV11(container)}
    catch(e){toast(e.detail||e.message,"error");b.disabled=false;b.textContent="Enviar a TEST"}
  });
  pb.querySelectorAll("[data-sync-package]").forEach(b=>b.onclick=async()=>{
    b.disabled=true;
    try{await api.post(`/postgrid/packages/${b.dataset.syncPackage}/sync`,{});toast("Estado actualizado","success");await renderMailingsV11(container)}
    catch(e){toast(e.detail||e.message,"error");b.disabled=false}
  });

  document.getElementById("pg11-test").onclick=async()=>{
    const b=document.getElementById("pg11-test");b.disabled=true;b.textContent="Probando…";
    try{const r=await api.post("/postgrid/test",{});toast(r.message||"Conexión correcta","success");await renderMailingsV11(container)}
    catch(e){toast(e.message,"error");b.disabled=false;b.textContent="Probar conexión"}
  };
}
