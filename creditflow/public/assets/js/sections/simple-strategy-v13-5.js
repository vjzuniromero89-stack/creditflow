import { api } from "../api.js";
import { toast } from "../toast.js";
import { escapeHtml } from "../utils.js";

function style(){
  if(document.getElementById("cf135-style"))return;
  const s=document.createElement("style");s.id="cf135-style";
  s.textContent=`
  .cf135{display:grid;gap:14px}
  .cf135-hero{padding:20px;border:1px solid rgba(86,153,255,.24);border-radius:16px;background:linear-gradient(135deg,rgba(67,113,255,.09),rgba(50,190,150,.06));display:flex;justify-content:space-between;gap:18px;align-items:center}
  .cf135-hero h2{margin:4px 0 7px}.cf135-hero p{margin:0;color:var(--cf7-muted);font-size:12px;line-height:1.55;max-width:760px}
  .cf135-flow{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.cf135-step{padding:12px;border:1px solid rgba(120,150,170,.18);border-radius:12px;background:rgba(8,23,34,.48)}.cf135-step strong{display:block;font-size:12px}.cf135-step small{color:var(--cf7-muted);font-size:10px}
  .cf135-kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.cf135-kpi{padding:13px;border:1px solid rgba(120,150,170,.18);border-radius:12px;background:rgba(8,23,34,.48)}.cf135-kpi span{display:block;font-size:24px;font-weight:800}.cf135-kpi strong{font-size:11px}.cf135-note{font-size:11px;color:var(--cf7-muted);padding:11px 13px;border-left:3px solid rgba(255,170,60,.45)}
  @media(max-width:800px){.cf135-flow,.cf135-kpis{grid-template-columns:repeat(2,1fr)}}@media(max-width:560px){.cf135-hero{align-items:flex-start;flex-direction:column}.cf135-flow,.cf135-kpis{grid-template-columns:1fr}}
  `;
  document.head.appendChild(s);
}

export async function renderSimpleStrategyV135(container,clientId,opts={}){
  style();
  container.innerHTML=`<div class="card">Cargando estrategia…</div>`;
  let st={negatives:0,generated:0,ready:0,missing_address:0,drafts:0};
  try{st=await api.get(`/simple-strategy/client/${clientId}/status`)}catch{}

  const started=st.generated>0;
  container.innerHTML=`<section class="cf135">
    <div class="cf135-hero">
      <div>
        <div class="cf7-eyebrow">CreditFlow Strategy Engine</div>
        <h2>${started?"Estrategia preparada":"Empezar estrategia"}</h2>
        <p>${started
          ?"CreditFlow ya creó la estrategia para las cuentas negativas elegibles. El siguiente paso es aprobar las cartas y enviarlas a Envíos certificados."
          :"Un solo botón crea la estrategia para collections, charge-offs, late payments e inquiries. No hay una sección separada de Aggressive Compliance, ni auditoría/investigación manual previa."}</p>
      </div>
      ${started
        ? `<button class="btn btn-primary" id="cf135-approve">Aprobar y mandar a Envíos</button>`
        : `<button class="btn btn-primary" id="cf135-start">Empezar estrategia</button>`}
    </div>

    <div class="cf135-flow">
      <div class="cf135-step"><strong>1. Empezar estrategia</strong><small>analiza categorías negativas</small></div>
      <div class="cf135-step"><strong>2. Crear cartas</strong><small>plantilla correcta por tipo</small></div>
      <div class="cf135-step"><strong>3. Aprobar</strong><small>revisión final antes del correo</small></div>
      <div class="cf135-step"><strong>4. Envíos</strong><small>PostGrid / Certified Mail</small></div>
    </div>

    <div class="cf135-kpis">
      <div class="cf135-kpi"><span>${st.negatives||0}</span><strong>NEGATIVOS</strong></div>
      <div class="cf135-kpi"><span>${st.generated||0}</span><strong>CARTAS GENERADAS</strong></div>
      <div class="cf135-kpi"><span>${st.ready||0}</span><strong>LISTAS PARA ENVÍO</strong></div>
      <div class="cf135-kpi"><span>${st.missing_address||0}</span><strong>FALTA DIRECCIÓN</strong></div>
    </div>

    ${st.missing_address?`<div class="cf135-note">${st.missing_address} carta(s) todavía no pueden pasar a Envíos porque falta la dirección postal del acreedor/collector. Eso es un requisito operativo, no una etapa de evidencia.</div>`:""}
  </section>`;

  container.querySelector("#cf135-start")?.addEventListener("click",async e=>{
    const b=e.currentTarget;b.disabled=true;b.textContent="Preparando estrategia…";
    try{
      const r=await api.post(`/simple-strategy/client/${clientId}/start`,{});
      toast(`${r.generated} carta(s) de estrategia preparadas`,"success");
      await renderSimpleStrategyV135(container,clientId,opts);
      opts.onChanged?.();
    }catch(err){toast(err.message||"No se pudo iniciar la estrategia","error");b.disabled=false;b.textContent="Empezar estrategia"}
  });

  container.querySelector("#cf135-approve")?.addEventListener("click",async e=>{
    const b=e.currentTarget;b.disabled=true;b.textContent="Preparando Envíos…";
    try{
      const r=await api.post(`/simple-strategy/client/${clientId}/approve-all`,{});
      toast(`${r.ready} carta(s) listas en Envíos certificados`,"success");
      await renderSimpleStrategyV135(container,clientId,opts);
      opts.onChanged?.();
    }catch(err){toast(err.message||"No se pudieron preparar los envíos","error");b.disabled=false;b.textContent="Aprobar y mandar a Envíos"}
  });
}
