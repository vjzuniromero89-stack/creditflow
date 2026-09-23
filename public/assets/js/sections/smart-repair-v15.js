import { api } from "../api.js";
import { toast } from "../toast.js";
import { escapeHtml } from "../utils.js";

const BUREAUS=["Experian","Equifax","TransUnion"];

function styles(){
 if(document.getElementById("cf15-smart-style"))return;
 const x=document.createElement("style");x.id="cf15-smart-style";x.textContent=`
 .cf15-smart{display:grid;gap:14px}.cf15-smart-hero{padding:22px;border:1px solid rgba(88,160,255,.25);border-radius:18px;background:linear-gradient(135deg,rgba(88,78,190,.17),rgba(16,130,145,.12));display:flex;justify-content:space-between;gap:18px;align-items:center}
 .cf15-smart-hero h2{margin:5px 0 7px}.cf15-smart-hero p{margin:0;max-width:800px;color:var(--cf7-muted)}
 .cf15-bureau-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.cf15-bureau-tab{padding:14px;border:1px solid rgba(130,160,190,.2);border-radius:14px;background:rgba(8,20,31,.55);text-align:left;cursor:pointer;color:inherit}.cf15-bureau-tab.active{border-color:#5b8cff;background:rgba(70,85,190,.18)}
 .cf15-bureau-tab strong,.cf15-bureau-tab span{display:block}.cf15-bureau-tab span{font-size:11px;color:var(--cf7-muted);margin-top:4px}
 .cf15-pack{padding:18px;border:1px solid rgba(130,160,190,.18);border-radius:15px;background:rgba(7,18,28,.5)}.cf15-pack-head{display:flex;justify-content:space-between;gap:15px;align-items:flex-start;flex-wrap:wrap}.cf15-list{display:grid;gap:7px;margin-top:13px}.cf15-letter{padding:10px 12px;border-radius:10px;background:rgba(255,255,255,.035);display:flex;justify-content:space-between;gap:10px}.cf15-letter small{color:var(--cf7-muted)}
 .cf15-actions{display:flex;gap:8px;flex-wrap:wrap}.cf15-empty{padding:24px;text-align:center;color:var(--cf7-muted)}
 @media(max-width:720px){.cf15-smart-hero{align-items:flex-start;flex-direction:column}.cf15-bureau-tabs{grid-template-columns:1fr}}
 @media print{body *{visibility:hidden!important}.cf15-print-area,.cf15-print-area *{visibility:visible!important}.cf15-print-area{position:absolute;left:0;top:0;width:100%;background:#fff;color:#000}.cf15-print-letter{break-after:page;page-break-after:always;white-space:pre-wrap;font:12pt/1.45 Arial,sans-serif;padding:.65in}.cf15-print-doc{break-before:page;page-break-before:always;max-width:100%}.no-print{display:none!important}}
 `;document.head.appendChild(x);
}
function group(letters,bureau){
 return (letters||[]).filter(l=>String(l.recipient_name||"").toLowerCase().includes(bureau.toLowerCase()));
}
export async function renderSmartLetters(container,clientId){
 styles();
 let st;try{st=await api.get(`/smart-repair/client/${clientId}/status`)}catch(e){container.innerHTML=`<div class="card">No se pudo cargar: ${escapeHtml(e.message)}</div>`;return}
 const counts=Object.fromEntries(BUREAUS.map(b=>[b,group(st.letters,b).length]));
 container.innerHTML=`<section class="cf15-smart">
  <div class="cf15-smart-hero">
   <div><div class="cf7-eyebrow">CREDITFLOW SMART REPAIR · v15</div><h2>${st.letters?.length?"Paquetes de cartas":"Generar cartas"}</h2>
   <p>${st.letters?.length?`Round ${st.current_round}: CreditFlow organizó automáticamente las cartas por buró. Revisa e imprime cada paquete completo.`:"CreditFlow estudia el reporte, detecta si es un cliente nuevo y decide automáticamente el primer round. Para un cliente nuevo prepara la revisión de información personal y las cuentas negativas que corresponden a cada buró."}</p></div>
   <button class="btn btn-primary" id="cf15-generate">${st.letters?.length?"Generar siguiente round":"Generar cartas"}</button>
  </div>
  <div class="cf15-bureau-tabs">${BUREAUS.map((b,i)=>`<button class="cf15-bureau-tab ${i===0?"active":""}" data-bureau="${b}"><strong>Cartas ${b}</strong><span>${counts[b]} carta(s) · Round ${st.current_round||1}</span></button>`).join("")}</div>
  <div id="cf15-bureau-body"></div>
 </section>`;
 const body=container.querySelector("#cf15-bureau-body");
 async function open(bureau){
   container.querySelectorAll("[data-bureau]").forEach(x=>x.classList.toggle("active",x.dataset.bureau===bureau));
   const letters=group(st.letters,bureau);
   if(!letters.length){body.innerHTML=`<div class="cf15-empty card">Todavía no hay cartas para ${bureau}.</div>`;return}
   body.innerHTML=`<div class="cf15-pack">
    <div class="cf15-pack-head"><div><div class="cf7-eyebrow">${bureau.toUpperCase()} · ROUND ${st.current_round}</div><h3>Paquete ${bureau}</h3><p>${letters.length} documento(s) preparados para este buró.</p></div>
    <div class="cf15-actions"><button class="btn btn-primary" id="cf15-print">Imprimir paquete completo</button><button class="btn btn-ghost" id="cf15-sent">Marcar paquete enviado</button></div></div>
    <div class="cf15-list">${letters.map(l=>`<div class="cf15-letter"><div><strong>${escapeHtml(l.title)}</strong><small>${escapeHtml(l.template_name||"Carta CreditFlow")}</small></div><span>${escapeHtml(l.status||"borrador")}</span></div>`).join("")}</div>
    <div class="cf15-print-area" id="cf15-print-area" style="display:none">${letters.map(l=>`<article class="cf15-print-letter">${escapeHtml(l.body||"")}</article>`).join("")}${st.documents?.id?`<img class="cf15-print-doc" src="/api/clients/${clientId}/documents/${st.documents.id}/file">`:""}${st.documents?.proof_address?`<img class="cf15-print-doc" src="/api/clients/${clientId}/documents/${st.documents.proof_address}/file">`:""}</div>
   </div>`;
   body.querySelector("#cf15-print").onclick=()=>{const p=body.querySelector("#cf15-print-area");p.style.display="block";window.print();setTimeout(()=>p.style.display="none",300)};
   body.querySelector("#cf15-sent").onclick=async()=>{if(!confirm(`¿Confirmas que enviaste el paquete de ${bureau}?`))return;try{await api.post(`/smart-repair/client/${clientId}/bureau/${bureau}/mark-sent`,{round:st.current_round});toast(`Paquete ${bureau} marcado como enviado`,"success");await renderSmartLetters(container,clientId)}catch(e){toast(e.message,"error")}};
 }
 container.querySelectorAll("[data-bureau]").forEach(x=>x.onclick=()=>open(x.dataset.bureau));
 await open("Experian");
 container.querySelector("#cf15-generate").onclick=async e=>{const b=e.currentTarget;b.disabled=true;b.textContent="Analizando reporte…";try{const r=await api.post(`/smart-repair/client/${clientId}/generate`,{});toast(`${r.generated} carta(s) preparadas para Round ${r.round}`,"success");await renderSmartLetters(container,clientId)}catch(err){toast(err.detail||err.message,"error");b.disabled=false;b.textContent="Generar cartas"}};
}
