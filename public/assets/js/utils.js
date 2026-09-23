export const LETTER_STATUS_FLOW = ["borrador", "lista", "enviada", "en_transito", "entregada", "completada"];

export const STATUS_META = {
  borrador: { label: "Borrador" },
  lista: { label: "Lista para enviar" },
  enviada: { label: "Enviada" },
  en_transito: { label: "En tránsito" },
  entregada: { label: "Entregada" },
  devuelta: { label: "Devuelta" },
  respondida: { label: "Respondida" },
  completada: { label: "Completada" },
};

export function statusBadge(status) {
  const meta = STATUS_META[status] || { label: status };
  return `<span class="badge badge-${status}">${meta.label}</span>`;
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDate(str) {
  if (!str) return "—";
  try {
    const d = new Date(str.includes("T") || str.includes("Z") ? str : str.replace(" ", "T") + "Z");
    return d.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  } catch {
    return str;
  }
}

export function formatDateTime(str) {
  if (!str) return "—";
  try {
    const d = new Date(str.includes("T") || str.includes("Z") ? str : str.replace(" ", "T") + "Z");
    return d.toLocaleString("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return str;
  }
}

export function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] || "") + (parts[1]?.[0] || "")).toUpperCase();
}

export function todayLong() {
  return new Date().toLocaleDateString("en-US", { day: "2-digit", month: "long", year: "numeric" });
}

export function debounce(fn, ms = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}
