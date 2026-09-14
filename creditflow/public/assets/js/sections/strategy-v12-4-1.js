import { renderProfessionalStrategyV9 as renderBaseStrategy } from "./strategy-v9.js";
import { api } from "../api.js";

function ensureStyle(){
 if(document.getElementById("cf1241-style"))return;
 const s=document.createElement("style");s.id="cf1241-style";
 s.textContent=`
 .cf1241-gate{margin:0 0 14px;padding:14px 16px;border:1px solid rgba(245,190,70,.30);border-radius:14px;background:rgba(245,190,70,.06);display:flex;justify-content:space-between;gap:14px;align-items:center}
 .cf1241-gate strong{display:block;font-size:13px}.cf1241-gate span{display:block;margin-top:4px;font-size:11px;color:var(--cf7-muted)}
 .cf1241-gate b{font-size:20px}.cf1241-disabled{opacity:.5!important;cursor:not-allowed!important}
 @media(max-width:800px){.cf1241-gate{flex-direction:column;align-items:flex-start}}
 `;
 document.head.appendChild(s);
}

export async function renderProfessionalStrategyV1241(container,clientId){
 await renderBaseStrategy(container,clientId);
 ensureStyle();

 let state;
 try{state=await api.get(`/strategy/client/${clientId}`)}catch{return}
 const active=(state.items||[]).filter(x=>x.removed_status!=="eliminado");
 const assessed=active.filter(x=>x.assessment?.human_verified).length;
 const total=active.length;
 const complete=total>0&&assessed===total;

 const hero=container.querySelector(".cf9-strategy-hero");
 if(!hero)return;

 const gate=document.createElement("div");
 gate.className="cf1241-gate";
 gate.innerHTML=complete
   ? `<div><strong>Auditoría completa</strong><span>Todos los negativos activos están revisados. Strategy Engine está habilitado.</span></div><b>${assessed}/${total}</b>`
   : `<div><strong>Completa Auditoría antes de construir estrategia</strong><span>Actualmente hay ${assessed} de ${total} negativos revisados. Regresa a Resumen → Auditoría.</span></div><b>${assessed}/${total}</b>`;
 hero.insertAdjacentElement("beforebegin",gate);

 const btn=container.querySelector("#cf9-build-plan");
 if(btn&&!complete){
   btn.disabled=true;
   btn.classList.add("cf1241-disabled");
   btn.textContent="Auditoría pendiente";
   btn.title=`Faltan ${total-assessed} ítems por auditar`;
 }
 if(!complete){
   container.querySelectorAll("[data-assess]").forEach(b=>b.style.display="none");
 }
}
