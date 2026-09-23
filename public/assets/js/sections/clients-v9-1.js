import {
  renderClientsList as renderClientsListV9,
  renderClientDetail as renderClientDetailV9,
} from "./clients-v9.js";
import { api } from "../api.js";
import { toast } from "../toast.js";
import { openModal } from "../modal.js";

export async function renderClientsList(container){
  await renderClientsListV9(container);
}

function confirmResetModal(clientId,onReset){
  const {close,body}=openModal({
    title:"Reiniciar reparación",
    wide:false,
    bodyHtml:`
      <div class="cf91-reset-warning">
        <div class="cf91-reset-icon">↺</div>
        <h3>¿Empezar este proceso desde cero?</h3>
        <p>
          Se eliminará únicamente el estado de la reparación, diagnósticos,
          estrategia y borradores generados por esa estrategia que todavía no hayan sido enviados.
        </p>
        <div class="cf91-preserve">
          <strong>Se conservará:</strong>
          <span>✓ Cliente</span>
          <span>✓ Reporte de crédito</span>
          <span>✓ Negativos</span>
          <span>✓ Documentos</span>
          <span>✓ Direcciones y scores</span>
          <span>✓ Cartas ya enviadas e historial postal</span>
        </div>
        <label class="cf91-confirm-check">
          <input type="checkbox" id="cf91-confirm-reset" />
          Confirmo que quiero reiniciar solamente el proceso de reparación.
        </label>
        <div class="form-actions">
          <button class="btn btn-ghost" data-close>Cancelar</button>
          <button class="btn btn-danger" id="cf91-reset-now" disabled>Reiniciar reparación</button>
        </div>
      </div>
    `
  });

  const check=body.querySelector("#cf91-confirm-reset");
  const resetBtn=body.querySelector("#cf91-reset-now");
  check.addEventListener("change",()=>resetBtn.disabled=!check.checked);
  body.querySelector("[data-close]").addEventListener("click",close);

  resetBtn.addEventListener("click",async()=>{
    resetBtn.disabled=true;
    resetBtn.textContent="Reiniciando…";
    try{
      const r=await api.post(`/repair-cases/${clientId}/reset`);
      close();
      toast(`Proceso reiniciado${r.removed_strategy_drafts?` · ${r.removed_strategy_drafts} borrador(es) de prueba eliminado(s)`:""}`,"success");
      await onReset();
    }catch(err){
      toast(err.message,"error");
      resetBtn.disabled=false;
      resetBtn.textContent="Reiniciar reparación";
    }
  });
}

async function addRepairControls(container,id){
  let state=null;
  try{state=await api.get(`/repair-cases/${id}`)}catch{}
  const repairCase=state?.case;
  if(!repairCase)return;

  const hero=container.querySelector(".cf7-client-hero");
  const workflow=container.querySelector("#cf8-repair-workflow");
  if(!hero && !workflow)return;

  // Prevent duplicates when the view re-renders.
  container.querySelector(".cf91-repair-controls")?.remove();

  const controls=document.createElement("div");
  controls.className="cf91-repair-controls";
  controls.innerHTML=`
    <div class="cf91-control-info">
      <span>Proceso de reparación</span>
      <strong>${repairCase.status==="paused"?"Pausado":"Activo"}</strong>
    </div>
    <div class="cf91-control-actions">
      ${
        repairCase.status==="paused"
          ? `<button class="btn btn-ghost btn-sm" id="cf91-resume">▶ Reanudar</button>`
          : `<button class="btn btn-ghost btn-sm" id="cf91-pause">⏸ Pausar</button>`
      }
      <button class="btn btn-danger btn-sm" id="cf91-reset">↺ Reiniciar reparación</button>
    </div>
  `;

  if(workflow) workflow.insertAdjacentElement("beforebegin",controls);
  else hero.insertAdjacentElement("afterend",controls);

  controls.querySelector("#cf91-pause")?.addEventListener("click",async()=>{
    try{
      await api.post(`/repair-cases/${id}/pause`,{reason:"Pausado manualmente desde el expediente del cliente."});
      toast("Reparación pausada","success");
      await renderClientDetail(container,id);
    }catch(err){toast(err.message,"error")}
  });

  controls.querySelector("#cf91-resume")?.addEventListener("click",async()=>{
    try{
      await api.post(`/repair-cases/${id}/resume`);
      toast("Reparación reanudada","success");
      await renderClientDetail(container,id);
    }catch(err){toast(err.message,"error")}
  });

  controls.querySelector("#cf91-reset")?.addEventListener("click",()=>{
    confirmResetModal(id,async()=>renderClientDetail(container,id));
  });
}

export async function renderClientDetail(container,id){
  await renderClientDetailV9(container,id);
  await addRepairControls(container,id);
}
