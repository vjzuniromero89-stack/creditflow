import { api } from "../api.js";
import { icon } from "../icons.js";
import { toast } from "../toast.js";
import { escapeHtml } from "../utils.js";
import { renderTemplates as renderTemplatesBase } from "./templates.js";

const PLAYBOOK=[
  ["01","Personal Information","Datos identificatorios incorrectos o mixed file."],
  ["10","CRA Factual Dispute","Primera disputa específica basada en una inexactitud real."],
  ["11","Unauthorized Inquiry","Solo cuando el consumidor confirma que no reconoce/autoriza la inquiry."],
  ["12","Identity Theft","Ruta separada para fraude real documentado."],
  ["20","Debt Collector","Solicitud de información/validación cuando corresponde."],
  ["21","Furnisher","Disputa directa de información suministrada por acreedor/furnisher."],
  ["30","New Evidence","Follow-up solo con nueva evidencia o base materialmente diferente."],
  ["31","Procedure Review","Solicitud de descripción del procedimiento tras un resultado verified."],
  ["32","Reinsertion","Ítem eliminado que reaparece."],
  ["40","Goodwill","Información negativa correcta: solicitud voluntaria, no disputa."],
  ["41","Post-Payment","Balance/estatus incorrecto después de pago o settlement."],
  ["50","Escalation","Paquete documental para escalación de un error no resuelto."],
];

export async function renderTemplatesV9(container){
  container.innerHTML=`
    <section class="cf9-library-hero">
      <div><div class="cf7-eyebrow">CreditFlow Playbook</div><h2>Estrategia y biblioteca profesional</h2>
      <p>La plantilla no decide el caso. Primero se diagnostica el problema; luego CreditFlow selecciona la herramienta apropiada.</p></div>
      <button class="btn btn-primary" id="cf9-install-pro">${icon("spark")} Instalar / completar biblioteca profesional</button>
    </section>
    <section class="cf9-playbook">
      ${PLAYBOOK.map(([c,t,d])=>`<div><span>${c}</span><strong>${t}</strong><small>${d}</small></div>`).join("")}
    </section>
    <div class="cf9-library-divider"><strong>Plantillas disponibles</strong><span>Puedes seguir creando y editando tus propias plantillas.</span></div>
    <div id="cf9-base-templates"></div>
  `;
  const base=container.querySelector("#cf9-base-templates");
  await renderTemplatesBase(base);
  container.querySelector("#cf9-install-pro").addEventListener("click",async(e)=>{
    const btn=e.currentTarget;btn.disabled=true;
    try{
      const r=await api.post("/pro-templates/install");
      toast(r.inserted?`${r.inserted} plantilla(s) profesional(es) instalada(s)`:"Biblioteca profesional completa","success");
      await renderTemplatesV9(container);
    }catch(err){toast(err.message,"error");btn.disabled=false}
  });
}
