import { renderProfessionalStrategyV9 as renderBaseStrategy } from "./strategy-v9.js";
import { api } from "../api.js";
import { toast } from "../toast.js";

function ensureStyle(){
 if(document.getElementById("cf125-style"))return;
 const s=document.createElement("style");s.id="cf125-style";
 s.textContent=`
 .cf125-gate{margin:0 0 14px;padding:14px 16px;border:1px solid rgba(77,208,225,.28);border-radius:14px;background:rgba(77,208,225,.055);display:flex;justify-content:space-between;gap:14px;align-items:center}
 .cf125-gate strong{display:block;font-size:13px}.cf125-gate span{display:block;margin-top:4px;font-size:11px;color:var(--cf7-muted);line-height:1.45}
 .cf125-gate b{font-size:20px;white-space:nowrap}.cf125-actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
 .cf125-auto{min-width:220px}.cf125-auto:disabled{opacity:.65}
 @media(max-width:800px){.cf125-gate{flex-direction:column;align-items:flex-start}}
 `;
 document.head.appendChild(s);
}
export async function renderProfessionalStrategyV1241(container,clientId){
 await renderBaseStrategy(container,clientId);
 ensureStyle();

 // v12.8 visual normalization: automatic assessments are completed audits,
 // not "Revisión pendiente".
 try{
   const uiState=await api.get(`/strategy/client/${clientId}`);
   const cards=[...container.querySelectorAll(".cf9-item-card")];
   (uiState.items||[]).forEach((item,idx)=>{
     const card=cards[idx];
     if(!card)return;
     if(item.assessment?.auto_ready&&!item.assessment?.human_verified){
       const badge=card.querySelector(".cf9-status");
       if(badge){badge.textContent="Auditado por sistema";badge.className="cf9-status ready";}
       const diag=card.querySelector(".cf9-diagnosis");
       if(diag && item.assessment.accuracy_status==="unknown"){
         const boxes=diag.querySelectorAll("div");
         if(boxes[0]?.querySelector("strong"))boxes[0].querySelector("strong").textContent="Sin inconsistencia detectada";
         if(boxes[1]?.querySelector("strong"))boxes[1].querySelector("strong").textContent="Auto Audit";
         if(boxes[2]?.querySelector("strong"))boxes[2].querySelector("strong").textContent="Comparación del reporte";
       }
     }
     card.querySelectorAll(".cf9-action-row").forEach(row=>{
       const txt=row.textContent||"";
       if(txt.includes("no_factual_dispute")){
         const strong=row.querySelector("strong");if(strong)strong.textContent="Sin disputa factual";
       }
       if(txt.includes("grouped_with_primary")){
         const strong=row.querySelector("strong");if(strong)strong.textContent="Cuenta consolidada";
       }
     });
   });
 }catch{}
 let state;try{state=await api.get(`/strategy/client/${clientId}`)}catch{return}
 const active=(state.items||[]).filter(x=>x.removed_status!=="eliminado");
 const eligible=active.filter(x=>x.assessment?.human_verified||x.assessment?.auto_ready).length;
 const human=active.filter(x=>x.assessment?.human_verified).length;
 const total=active.length,complete=total>0&&eligible===total,autoCount=eligible-human;

 const hero=container.querySelector(".cf9-strategy-hero");
 if(!hero)return;
 const gate=document.createElement("div");gate.className="cf125-gate";
 gate.innerHTML=complete
 ? `<div><strong>Auditoría lista para estrategia</strong><span>${human} revisión(es) humana(s) y ${autoCount} auditoría(s) preparadas automáticamente por CreditFlow.</span></div><div class="cf125-actions"><b>${eligible}/${total}</b></div>`
 : `<div><strong>CreditFlow puede preparar la auditoría automáticamente</strong><span>El sistema comparará los burós, clasificará las cuentas y luego construirá la estrategia en un segundo paso automático.</span></div>
    <div class="cf125-actions"><b>${eligible}/${total}</b><button class="btn btn-primary cf125-auto" id="cf125-auto">Automatizar auditoría + estrategia</button></div>`;
 hero.insertAdjacentElement("beforebegin",gate);

 const kpi=container.querySelector(".cf9-kpis > div:nth-child(2) span");if(kpi)kpi.textContent=String(eligible);
 const kpiLabel=container.querySelector(".cf9-kpis > div:nth-child(2) strong");if(kpiLabel)kpiLabel.textContent="Auditados";

 const build=container.querySelector("#cf9-build-plan");
 if(build&&!complete){build.disabled=true;build.textContent="Auditoría pendiente";}

 active.forEach((item,idx)=>{
   if(item.assessment?.auto_ready&&!item.assessment?.human_verified){
     const card=container.querySelectorAll(".cf9-item-card")[idx];
     const badge=card?.querySelector(".cf9-status");
     if(badge){badge.textContent="Auditado por sistema";badge.className="cf9-status ready";}
   }
 });

 gate.querySelector("#cf125-auto")?.addEventListener("click",async(e)=>{
   const btn=e.currentTarget;btn.disabled=true;btn.textContent="1/2 Auditando cuentas…";
   try{
     const audit=await api.post(`/automation/client/${clientId}/prepare-strategy`);
     btn.textContent="2/2 Construyendo estrategia…";
     const buildResult=await api.post(`/strategy/client/${clientId}/build`);
     toast(`${audit.processed||0} cuenta(s) auditadas; ${buildResult.planned||0} acción(es) listas; ${buildResult.blocked||0} en revisión`,"success");
     await renderProfessionalStrategyV1241(container,clientId);
   }catch(err){
     const detail=err?.data?.detail||err?.detail||"";
     toast(`${err.message||"No se pudo completar la automatización"}${detail?` — ${detail}`:""}`,"error");
     btn.disabled=false;btn.textContent="Automatizar auditoría + estrategia";
   }
 });
}
