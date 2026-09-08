import { api } from "../api.js";
import { icon } from "../icons.js";
import { openModal, confirmDialog } from "../modal.js";
import { toast } from "../toast.js";
import { escapeHtml, formatDate } from "../utils.js";

export const PLACEHOLDERS = [
  "{{cliente_nombre}}",
  "{{cliente_direccion}}",
  "{{cliente_ciudad_estado_zip}}",
  "{{cliente_id_last4}}",
  "{{cliente_fecha_nacimiento}}",
  "{{fecha}}",
  "{{destinatario_nombre}}",
  "{{destinatario_direccion}}",
  "{{numero_cuenta}}",
  "{{acreedor_nombre}}",
  "{{motivo_disputa}}",
  "{{ronda}}",
];

function placeholderHelp(textareaSelector) {
  return `
    <div class="field" style="margin-top:4px">
      <label>Campos disponibles (haz clic para insertar)</label>
      <div>${PLACEHOLDERS.map((p) => `<span class="placeholder-chip" data-ph="${p}" data-target="${textareaSelector}">${p}</span>`).join("")}</div>
    </div>
  `;
}

function wirePlaceholderChips(root) {
  root.querySelectorAll(".placeholder-chip").forEach((chip) =>
    chip.addEventListener("click", () => {
      const target = root.querySelector(chip.dataset.target);
      if (!target) return;
      const start = target.selectionStart ?? target.value.length;
      const end = target.selectionEnd ?? target.value.length;
      target.value = target.value.slice(0, start) + chip.dataset.ph + target.value.slice(end);
      target.focus();
      target.selectionStart = target.selectionEnd = start + chip.dataset.ph.length;
    })
  );
}

function templateFormHtml(t = {}) {
  return `
    <form id="template-form">
      <div class="form-grid" style="margin-bottom:14px">
        <div class="field" style="grid-column:1/-1"><label>Nombre de la plantilla *</label><input type="text" name="name" required value="${escapeHtml(t.name)}" /></div>
        <div class="field"><label>Categoría</label><input type="text" name="category" placeholder="Ej. Buró de Crédito" value="${escapeHtml(t.category)}" /></div>
        <div class="field"><label>Destinatario sugerido</label><input type="text" name="recipient_hint" placeholder="Ej. Equifax" value="${escapeHtml(t.recipient_hint)}" /></div>
        <div class="field" style="grid-column:1/-1"><label>Asunto</label><input type="text" name="subject" value="${escapeHtml(t.subject)}" /></div>
      </div>
      <div class="field">
        <label>Contenido de la carta *</label>
        <textarea name="body" id="tpl-body" style="min-height:280px" required>${escapeHtml(t.body)}</textarea>
      </div>
      ${placeholderHelp("#tpl-body")}
      <div class="field" style="margin-top:14px">
        <label>Adjuntos automáticos</label>
        <p class="text-sm text-muted" style="margin-bottom:8px">Cuando esta plantilla se use para generar una carta, ¿hay que agregar automáticamente estas copias del cliente al imprimir?</p>
        <label class="flex gap-8" style="align-items:center;font-weight:400;margin-bottom:6px">
          <input type="checkbox" name="include_id_copy" ${t.include_id_copy ? "checked" : ""} /> Incluir copia de identificación (ID)
        </label>
        <label class="flex gap-8" style="align-items:center;font-weight:400;margin-bottom:6px">
          <input type="checkbox" name="include_address_proof" ${t.include_address_proof ? "checked" : ""} /> Incluir comprobante de domicilio
        </label>
        <label class="flex gap-8" style="align-items:center;font-weight:400">
          <input type="checkbox" name="include_ssn_copy" ${t.include_ssn_copy ? "checked" : ""} /> Incluir copia de Social Security
        </label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-ghost" data-close>Cancelar</button>
        <button type="submit" class="btn btn-primary">${t.id ? "Guardar cambios" : "Crear plantilla"}</button>
      </div>
    </form>
  `;
}

function openTemplateModal(existing, onSaved) {
  const { overlay, close, body } = openModal({
    title: existing ? "Editar plantilla" : "Nueva plantilla",
    bodyHtml: templateFormHtml(existing || {}),
    wide: true,
  });
  wirePlaceholderChips(body);
  body.querySelector("[data-close]").addEventListener("click", close);
  body.querySelector("#template-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    // Los checkboxes sin marcar no aparecen en FormData — hay que forzarlos explícitamente
    // para que un "desmarcar" al editar sí se guarde como false.
    payload.include_id_copy = fd.get("include_id_copy") === "on";
    payload.include_address_proof = fd.get("include_address_proof") === "on";
    payload.include_ssn_copy = fd.get("include_ssn_copy") === "on";
    try {
      if (existing) {
        await api.put(`/templates/${existing.id}`, payload);
        toast("Plantilla actualizada", "success");
      } else {
        await api.post("/templates", payload);
        toast("Plantilla creada", "success");
      }
      close();
      onSaved();
    } catch (err) {
      toast(err.message, "error");
    }
  });
}

export async function renderTemplates(container) {
  container.innerHTML = `
    <div class="section-head">
      <div class="sub">Estas cartas se usan como base al crear una nueva carta para un cliente. Puedes editarlas, agregar las tuyas o borrar las de ejemplo.</div>
      <div class="flex gap-12">
        <input type="file" id="import-file-input" accept=".pdf,.docx" style="display:none" />
        <button class="btn btn-ghost" id="import-btn">${icon("spark")} Importar PDF / Word</button>
        <button class="btn btn-ghost" id="seed-btn">${icon("spark")} Cargar ejemplos</button>
        <button class="btn btn-primary" id="new-tpl-btn">${icon("plus")} Nueva plantilla</button>
      </div>
    </div>
    <p class="text-sm text-muted" style="margin-top:-8px;margin-bottom:16px">
      Puedes importar tus propias cartas en <strong>.docx</strong> (recomendado, más confiable) o <strong>.pdf</strong> (funciona bien si el PDF tiene texto real, no una imagen escaneada). El texto se guarda automáticamente como una plantilla lista para usar — solo revisa el resultado y ajusta los espacios si hace falta.
    </p>
    <div id="tpl-folders"></div>
  `;

  // Orden de la estrategia de disputa: primero limpiar información personal, luego
  // rondas 1→2→3, inquiries, acreedor original y por último cobradores. Cualquier
  // categoría que no calce con estos patrones (p. ej. "Importado", "General") queda
  // al final, en orden alfabético entre ellas.
  const CATEGORY_ORDER = [
    { rank: 0, test: /informaci[oó]n personal|limpieza/i },
    { rank: 1, test: /ronda\s*1/i },
    { rank: 2, test: /ronda\s*2/i },
    { rank: 3, test: /ronda\s*3/i },
    { rank: 4, test: /inquir/i },
    { rank: 5, test: /disputa directa/i },
    { rank: 6, test: /negociaci[oó]n|pay for delete/i },
    { rank: 7, test: /aviso final/i },
    { rank: 8, test: /cobrador/i },
  ];
  function categoryRank(cat) {
    const found = CATEGORY_ORDER.find((c) => c.test.test(cat || ""));
    return found ? found.rank : 99;
  }

  function groupByCategory(templates) {
    const groups = new Map();
    templates.forEach((t) => {
      const cat = t.category || "General";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(t);
    });
    return [...groups.entries()].sort((a, b) => {
      const ra = categoryRank(a[0]);
      const rb = categoryRank(b[0]);
      if (ra !== rb) return ra - rb;
      return a[0].localeCompare(b[0]);
    });
  }

  function templateCardHtml(t) {
    return `
      <div class="card card-hover" data-id="${t.id}" style="cursor:pointer">
        <div class="flex-between">
          <div>
            <div class="row-name">${escapeHtml(t.name)}</div>
            <div class="row-sub">${t.recipient_hint ? escapeHtml(t.recipient_hint) : ""}</div>
          </div>
          <div class="cell-actions">
            <button class="btn btn-ghost btn-sm btn-icon" data-edit="${t.id}">${icon("edit")}</button>
            <button class="btn btn-danger btn-sm btn-icon" data-del="${t.id}">${icon("trash")}</button>
          </div>
        </div>
        <p class="text-sm text-muted" style="margin-top:12px;max-height:60px;overflow:hidden">${escapeHtml(t.body).slice(0, 160)}...</p>
        ${
          t.include_id_copy || t.include_address_proof || t.include_ssn_copy
            ? `<div class="text-sm" style="margin-top:8px;color:var(--muted)">📎 Adjunta automáticamente: ${[t.include_id_copy ? "ID" : "", t.include_address_proof ? "comprobante de domicilio" : "", t.include_ssn_copy ? "Social Security" : ""].filter(Boolean).join(" + ")}</div>`
            : ""
        }
        <div class="text-sm text-muted" style="margin-top:8px">Actualizada ${formatDate(t.updated_at)}</div>
      </div>`;
  }

  async function load() {
    const { templates } = await api.get("/templates");
    const folders = document.getElementById("tpl-folders");
    if (!templates.length) {
      folders.innerHTML = `
        <div class="card empty">
          <div class="mark">📄</div>
          <h3>Aún no tienes plantillas</h3>
          <p>Carga tus 12 plantillas para empezar, o crea las tuyas propias.</p>
        </div>
      `;
      return;
    }
    const grouped = groupByCategory(templates);
    folders.innerHTML = grouped
      .map(
        ([cat, items], i) => `
      <details class="tpl-folder" style="margin-bottom:14px" ${i === 0 ? "open" : ""}>
        <summary style="cursor:pointer;font-size:15px;font-weight:600;padding:10px 0;display:flex;align-items:center;gap:8px">
          📁 ${escapeHtml(cat)} <span class="text-sm text-muted" style="font-weight:400">(${items.length})</span>
        </summary>
        <div class="grid grid-2" style="margin-top:6px">
          ${items.map(templateCardHtml).join("")}
        </div>
      </details>`
      )
      .join("");

    folders.querySelectorAll("[data-edit]").forEach((b) =>
      b.addEventListener("click", async (e) => {
        e.stopPropagation();
        const { template } = await api.get(`/templates/${b.dataset.edit}`);
        openTemplateModal(template, load);
      })
    );
    folders.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async (e) => {
        e.stopPropagation();
        const ok = await confirmDialog("¿Eliminar esta plantilla? Las cartas ya creadas con ella no se verán afectadas.");
        if (!ok) return;
        try {
          await api.del(`/templates/${b.dataset.del}`);
          toast("Plantilla eliminada", "success");
          load();
        } catch (err) {
          toast(err.message, "error");
        }
      })
    );
    folders.querySelectorAll(".card[data-id]").forEach((card) =>
      card.addEventListener("click", async () => {
        const { template } = await api.get(`/templates/${card.dataset.id}`);
        openTemplateModal(template, load);
      })
    );
  }

  document.getElementById("new-tpl-btn").addEventListener("click", () => openTemplateModal(null, load));
  document.getElementById("seed-btn").addEventListener("click", async () => {
    try {
      const r = await api.post("/templates/seed");
      toast(r.inserted > 0 ? `${r.inserted} plantilla(s) de ejemplo cargada(s)` : "Ya tenías todas las plantillas de ejemplo", r.inserted > 0 ? "success" : "info");
      load();
    } catch (err) {
      toast(err.message, "error");
    }
  });

  const importInput = document.getElementById("import-file-input");
  const importBtn = document.getElementById("import-btn");
  importBtn.addEventListener("click", () => importInput.click());
  importInput.addEventListener("change", async () => {
    const file = importInput.files[0];
    if (!file) return;
    const originalLabel = importBtn.innerHTML;
    importBtn.disabled = true;
    importBtn.innerHTML = `${icon("spark")} Importando…`;
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { template } = await api.upload("/templates/import", fd);
      toast(`Plantilla "${template.name}" importada. Revísala antes de usarla.`, "success");
      load();
      openTemplateModal(template, load);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      importBtn.disabled = false;
      importBtn.innerHTML = originalLabel;
      importInput.value = "";
    }
  });

  await load();
}
