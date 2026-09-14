import { api } from "../api.js";
import { escapeHtml } from "../utils.js";
import { renderTemplates as renderTemplatesBase } from "./templates.js";
import { renderLettersList as renderLettersListBase, renderLetterDetail as renderLetterDetailBase, renderNewLetter as renderNewLetterBase } from "./letters.js";
import { renderMailings as renderMailingsBase } from "./mailings.js";
import { renderPortalUsers as renderPortalUsersBase } from "./users.js";
import { renderSettings as renderSettingsBase } from "./settings.js";

function prependHero(container, eyebrow, title, text, steps = []) {
  const hero=document.createElement("section");
  hero.className="cf7-page-hero";
  hero.innerHTML=`
    <div><div class="cf7-eyebrow">${eyebrow}</div><h2>${title}</h2><p>${text}</p></div>
    ${steps.length?`<div class="cf7-page-flow">${steps.map((s,i)=>`<div><span>${i+1}</span><strong>${s}</strong></div>`).join("")}</div>`:""}
  `;
  container.prepend(hero);
}

export async function renderTemplatesV7(container){
  await renderTemplatesBase(container);
  prependHero(container,"Strategy library","Estrategia y plantillas","Organiza las cartas por propósito real: identidad, disputa factual, collector/furnisher, follow-up y escalación.",["Auditar","Elegir base","Generar","Revisar"]);
  container.classList.add("cf7-templates");
}

export async function renderLettersListV7(container){
  await renderLettersListBase(container);
  const {letters=[]}=await api.get("/letters");
  const count=(s)=>letters.filter(l=>l.status===s).length;
  const k=document.createElement("section");
  k.className="cf7-list-kpis cf7-letter-kpis";
  k.innerHTML=`
    <button><span>${letters.length}</span><strong>Total</strong><small>todas las cartas</small></button>
    <button><span>${count("borrador")}</span><strong>Borradores</strong><small>requieren revisión</small></button>
    <button><span>${count("lista")}</span><strong>Listas</strong><small>esperando envío</small></button>
    <button><span>${count("enviada")+count("en_transito")}</span><strong>En tránsito</strong><small>seguimiento activo</small></button>`;
  container.prepend(k);
  prependHero(container,"Correspondence workflow","Cartas","Cada carta debe tener propósito, etapa, destinatario y estado claramente visible.",["Borrador","Revisión","Envío","Resultado"]);
  container.classList.add("cf7-letters");
}

export async function renderLetterDetailV7(container,id){
  await renderLetterDetailBase(container,id);
  prependHero(container,"Letter workspace","Documento y seguimiento","Edita el contenido a la izquierda y controla el siguiente paso, tracking e historial a la derecha.");
  container.classList.add("cf7-letter-detail");
}

export async function renderNewLetterV7(container){
  await renderNewLetterBase(container);
  prependHero(container,"Manual compose","Nueva carta","Usa esta pantalla cuando necesites crear una carta fuera del flujo automático.");
  container.classList.add("cf7-new-letter");
}

export async function renderMailingsV7(container){
  await renderMailingsBase(container);
  prependHero(container,"Certified mail workflow","Envíos certificados","Procesa primero los lotes listos; después usa el historial para tracking y entrega.",["Preparar","Etiqueta","Enviar","Tracking"]);
  container.classList.add("cf7-mailings");
}

export async function renderPortalUsersV7(container){
  await renderPortalUsersBase(container);
  const {clients=[]}=await api.get("/clients");
  const withAccess=clients.filter(c=>c.portal_username).length;
  const k=document.createElement("section");
  k.className="cf7-list-kpis";
  k.innerHTML=`
    <button><span>${clients.length}</span><strong>Clientes</strong><small>total</small></button>
    <button><span>${withAccess}</span><strong>Con acceso</strong><small>portal creado</small></button>
    <button><span>${clients.length-withAccess}</span><strong>Sin acceso</strong><small>pendientes</small></button>
    <button><span>${clients.filter(c=>c.portal_must_change_password).length}</span><strong>Temporal</strong><small>deben cambiar clave</small></button>`;
  container.prepend(k);
  prependHero(container,"Client portal","Accesos de clientes","Administra el acceso privado de cada cliente sin entrar expediente por expediente.");
  container.classList.add("cf7-users");
}

export async function renderSettingsV7(container){
  await renderSettingsBase(container);
  prependHero(container,"System control","Ajustes","Seguridad de la cuenta, equipo e integraciones del sistema.");
  container.classList.add("cf7-settings");
}
