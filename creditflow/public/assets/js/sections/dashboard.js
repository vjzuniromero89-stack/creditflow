import { api } from "../api.js";
import { icon } from "../icons.js";
import { escapeHtml, formatDateTime, statusBadge } from "../utils.js";

const ACTION_LABELS = {
  cliente_creado: "Cliente creado",
  cliente_actualizado: "Cliente actualizado",
  cliente_eliminado: "Cliente eliminado",
  plantilla_creada: "Plantilla creada",
  plantilla_actualizada: "Plantilla actualizada",
  plantilla_eliminada: "Plantilla eliminada",
  plantillas_ejemplo_cargadas: "Plantillas de ejemplo cargadas",
  carta_creada: "Carta creada",
  carta_actualizada: "Carta actualizada",
  carta_eliminada: "Carta eliminada",
  cambio_estado: "Cambio de estado",
  carta_enviada: "Carta enviada por certificado",
  actualizacion_envio_manual: "Envío actualizado",
  rastreo_usps_actualizado: "Rastreo USPS actualizado",
  rastreo_masivo: "Rastreo masivo ejecutado",
  inicio_sesion: "Inicio de sesión",
  cambio_password: "Contraseña actualizada",
  usuario_creado: "Usuario creado",
  setup_inicial: "Configuración inicial",
};

export async function renderDashboard(container) {
  container.innerHTML = `<div class="grid grid-kpi" id="kpis"></div>
    <div class="grid grid-2" style="margin-top:22px">
      <div class="card">
        <div class="flex-between" style="margin-bottom:14px">
          <h3 style="font-size:15px">Cartas por enviar</h3>
          <a href="#/cartas" class="text-sm">Ver todas ${icon("arrowRight", "")}</a>
        </div>
        <div id="pending-letters"></div>
      </div>
      <div class="card">
        <h3 style="font-size:15px;margin-bottom:14px">Actividad reciente</h3>
        <div id="activity" class="timeline"></div>
      </div>
    </div>
  `;

  const data = await api.get("/dashboard/stats");
  const s = data.letters_by_status || {};

  document.getElementById("kpis").innerHTML = `
    <div class="card kpi-card kpi-c1">
      <div class="kpi-icon">${icon("users")}</div>
      <div class="kpi-label">Clientes activos</div>
      <div class="kpi-value">${data.clients_active}</div>
      <div class="kpi-bar"><span style="width:${data.clients_total ? (data.clients_active / data.clients_total) * 100 : 0}%"></span></div>
    </div>
    <div class="card kpi-card kpi-c2">
      <div class="kpi-icon">${icon("mail")}</div>
      <div class="kpi-label">Cartas totales</div>
      <div class="kpi-value">${data.letters_total}</div>
      <div class="kpi-bar"><span style="width:100%"></span></div>
    </div>
    <div class="card kpi-card kpi-c3">
      <div class="kpi-icon">${icon("send")}</div>
      <div class="kpi-label">Enviadas / en tránsito</div>
      <div class="kpi-value">${(s.enviada || 0) + (s.en_transito || 0)}</div>
      <div class="kpi-bar"><span style="width:${data.letters_total ? (((s.enviada || 0) + (s.en_transito || 0)) / data.letters_total) * 100 : 0}%"></span></div>
    </div>
    <div class="card kpi-card kpi-c4">
      <div class="kpi-icon">${icon("check")}</div>
      <div class="kpi-label">Entregadas</div>
      <div class="kpi-value">${s.entregada || 0}</div>
      <div class="kpi-bar"><span style="width:${data.letters_total ? ((s.entregada || 0) / data.letters_total) * 100 : 0}%"></span></div>
    </div>
  `;

  const pendingBox = document.getElementById("pending-letters");
  if (!data.pending_letters.length) {
    pendingBox.innerHTML = `<div class="empty"><div class="mark">✨</div><p>No hay cartas pendientes por ahora.</p></div>`;
  } else {
    pendingBox.innerHTML = data.pending_letters
      .map(
        (l) => `
      <div class="flex-between" style="padding:10px 0;border-bottom:1px solid var(--border);cursor:pointer" onclick="__creditflowNavigate('#/cartas/${l.id}')">
        <div>
          <div class="row-name">${escapeHtml(l.title)}</div>
          <div class="row-sub">${escapeHtml(l.client_name)}</div>
        </div>
        ${statusBadge(l.status)}
      </div>`
      )
      .join("");
  }

  const activityBox = document.getElementById("activity");
  if (!data.recent_activity.length) {
    activityBox.innerHTML = `<div class="empty"><div class="mark">🕓</div><p>Aún no hay actividad.</p></div>`;
  } else {
    activityBox.innerHTML = data.recent_activity
      .map(
        (a) => `
      <div class="timeline-item">
        <div class="timeline-body">
          <div class="t-action">${ACTION_LABELS[a.action] || a.action}</div>
          ${a.detail ? `<div class="t-detail">${escapeHtml(a.detail)}</div>` : ""}
          <div class="t-time">${formatDateTime(a.created_at)}</div>
        </div>
      </div>`
      )
      .join("");
  }
}

export { ACTION_LABELS };
