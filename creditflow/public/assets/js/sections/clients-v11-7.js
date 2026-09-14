import { renderClientsList as renderListV10, renderClientDetail as renderDetailV10 } from "./clients-v9-1.js";
import { renderCaseIntelligenceV10 } from "./case-intelligence-v10.js";
import { api } from "../api.js";
import { renderRealAuditV117 } from "./audit-v11-7.js";

export async function renderClientsList(container){await renderListV10(container)}

export async function renderClientDetail(container,id){
 await renderDetailV10(container,id);
 const history=container.querySelector('[data-panel="historial"]');
 if(history&&!history.querySelector("#cf10-intelligence")){
   const old=[...history.children];
   history.innerHTML=`<div id="cf10-intelligence"></div><div id="cf10-old-history"></div>`;
   old.forEach(n=>history.querySelector("#cf10-old-history").appendChild(n));
   await renderCaseIntelligenceV10(history.querySelector("#cf10-intelligence"),id);
 }
 let rs=null; try{rs=await api.get(`/repair-cases/${id}`)}catch{}
 const stage=rs?.case?.current_stage;
 const workflow=container.querySelector("#cf8-repair-workflow");
 if(!workflow)return;

 // If v8 already skipped audit (strategy_ready) but no human assessments exist,
 // reopen stage 3 automatically.
 let strategy=null; try{strategy=await api.get(`/strategy/client/${id}`)}catch{}
 const total=(strategy?.items||[]).filter(x=>x.removed_status!=="eliminado").length;
 const assessed=(strategy?.items||[]).filter(x=>x.removed_status!=="eliminado"&&x.assessment?.human_verified).length;
 if(["strategy_ready","approval_required"].includes(stage)&&total>0&&assessed<total){
   try{await api.post(`/audit-v11-7/${id}/reopen`);rs=await api.get(`/repair-cases/${id}`)}catch{}
 }
 if(rs?.case?.current_stage==="report_audit"){
   // Keep workflow header/stage track, replace the generic lower cards with the real audit.
   let host=workflow.querySelector("#cf117-audit-host");
   if(!host){host=document.createElement("div");host.id="cf117-audit-host";workflow.appendChild(host)}
   await renderRealAuditV117(host,id,{onComplete:async()=>renderClientDetail(container,id)});
 }
}
