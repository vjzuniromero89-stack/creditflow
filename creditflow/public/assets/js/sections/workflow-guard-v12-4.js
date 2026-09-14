import { api } from "../api.js";

function ensureStyle(){
 if(document.getElementById("cf124-style"))return;
 const s=document.createElement("style");s.id="cf124-style";
 s.textContent=`
 .cf124-gate{margin:0 0 14px;padding:14px 16px;border:1px solid rgba(245,190,70,.28);border-radius:14px;background:rgba(245,190,70,.06);display:flex;justify-content:space-between;gap:14px;align-items:center}
 .cf124-gate.ready{border-color:rgba(78,200,135,.30);background:rgba(78,200,135,.055)}
 .cf124-gate strong{display:block;font-size:13px}.cf124-gate span{display:block;margin-top:4px;font-size:11px;color:var(--cf7-muted);line-height:1.45}
 .cf124-count{font-size:22px!important;color:inherit!important;margin:0!important;white-space:nowrap}
 .cf124-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.cf124-disabled{opacity:.55;pointer-events:none}
 @media(max-width:800px){.cf124-gate{align-items:flex-start;flex-direction:column}}
 `;document.head.appendChild(s);
}
function switchTab(container,name){
 const btn=container.querySelector(`.cf7-client-tabs [data-tab="${name}"]`);
 if(btn){btn.click();setTimeout(()=>container.querySelector("#cf117-audit-host")?.scrollIntoView({behavior:"smooth",block:"start"}),120)}
}
export async function applyWorkflowGuardV124(container,clientId){
 ensureStyle();
 const panel=container.querySelector('[data-panel="estrategia"]');if(!panel)return;
 let state;try{state=await api.get(`/strategy/client/${clientId}`)}catch{return}
 const active=(state.items||[]).filter(x=>x.removed_status!=="eliminado");
 const assessed=active.filter(x=>x.assessment?.human_verified||x.assessment?.auto_ready).length;
 const human=active.filter(x=>x.assessment?.human_verified).length;
 const automatic=assessed-human,total=active.length,complete=total>0&&assessed===total;
 let gate=panel.querySelector("#cf124-gate");
 if(!gate){gate=document.createElement("div");gate.id="cf124-gate";const hero=panel.querySelector(".cf9-strategy-hero");hero?hero.insertAdjacentElement("beforebegin",gate):panel.prepend(gate)}
 gate.className=`cf124-gate ${complete?"ready":""}`;
 gate.innerHTML=complete
 ? `<div><strong>Auditoría lista para estrategia</strong><span>${human} revisión(es) humana(s) y ${automatic} auditoría(s) automáticas. No necesitas volver a auditar estas cuentas.</span></div><div class="cf124-actions"><b class="cf124-count">${assessed}/${total}</b></div>`
 : `<div><strong>Estrategia bloqueada hasta completar Auditoría</strong><span>Hay ${assessed} de ${total} negativos auditados.</span></div><div class="cf124-actions"><b class="cf124-count">${assessed}/${total}</b><button class="btn btn-primary" id="cf124-go-audit">Ir a Auditoría</button></div>`;
 gate.querySelector("#cf124-go-audit")?.addEventListener("click",()=>switchTab(container,"resumen"));
 const build=panel.querySelector("#cf9-build-plan");
 if(build){build.disabled=!complete;build.classList.toggle("cf124-disabled",!complete);build.title=complete?"Construir estrategia":"Completa o automatiza la Auditoría primero"}
 panel.querySelectorAll("[data-assess]").forEach(btn=>{btn.style.display=complete?"":"none"});
}
