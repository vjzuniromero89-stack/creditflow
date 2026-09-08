import { api } from "../api.js";
import { icon } from "../icons.js";
import { toast } from "../toast.js";
import { confirmDialog } from "../modal.js";
import { formatDate, escapeHtml } from "../utils.js";

export const DOC_META = {
  id: { label: "Identificación (ID)", hint: "Foto de licencia, pasaporte o ID estatal — clara y legible" },
  proof_address: { label: "Comprobante de domicilio", hint: "Foto de un bill reciente (luz, agua, etc.) a nombre y dirección actual del cliente" },
  ssn: { label: "Social Security", hint: "Foto de la tarjeta de Social Security del cliente — clara y legible" },
};

/* ------------------------------------------------------------------ */
/* Sección "Documentos del cliente" — ID y comprobante de domicilio    */
/* ------------------------------------------------------------------ */
export async function renderClientDocuments(container, clientId) {
  async function load() {
    const { documents } = await api.get(`/clients/${clientId}/documents`);
    draw(documents);
  }

  function draw(documents) {
    container.innerHTML = `
      <div class="grid grid-2">
        ${Object.entries(DOC_META)
          .map(([type, meta]) => {
            const doc = documents.find((d) => d.doc_type === type);
            return `
            <div class="card" data-type="${type}">
              <div class="flex-between" style="margin-bottom:8px">
                <h4 style="font-size:14px">${meta.label}</h4>
                <span class="badge ${doc ? "badge-completada" : "badge-otro"}">${doc ? "Subido" : "Falta"}</span>
              </div>
              <p class="text-sm text-muted" style="margin-bottom:10px">${meta.hint}</p>
              ${doc ? `<img src="/api/clients/${clientId}/documents/${doc.id}/file" class="doc-thumb" alt="${escapeHtml(meta.label)}" />` : ""}
              ${doc ? `<div class="text-sm text-muted" style="margin:8px 0">Subido ${formatDate(doc.updated_at)}</div>` : ""}
              <div class="flex gap-8" style="margin-top:8px">
                <input type="file" accept="image/jpeg,image/png,image/webp" data-file-input="${type}" style="display:none" />
                <button class="btn btn-ghost btn-sm" data-upload="${type}">${icon("upload")} ${doc ? "Reemplazar" : "Subir"}</button>
                ${doc ? `<button class="btn btn-danger btn-sm btn-icon" data-del="${doc.id}">${icon("trash")}</button>` : ""}
              </div>
            </div>
          `;
          })
          .join("")}
      </div>
      <p class="text-sm text-muted" style="margin-top:10px">Formatos: JPG, PNG o WEBP, máximo 1.5 MB cada uno. Cuando generes una carta que necesite estas copias, la app avisa si falta alguna y las agrega automáticamente al imprimir.</p>
    `;

    container.querySelectorAll("[data-upload]").forEach((btn) => {
      const type = btn.dataset.upload;
      const input = container.querySelector(`[data-file-input="${type}"]`);
      btn.addEventListener("click", () => input.click());
      input.addEventListener("change", async () => {
        const file = input.files[0];
        if (!file) return;
        const fd = new FormData();
        fd.append("doc_type", type);
        fd.append("file", file);
        btn.disabled = true;
        const orig = btn.innerHTML;
        btn.innerHTML = "Subiendo…";
        try {
          await api.upload(`/clients/${clientId}/documents`, fd);
          toast("Documento subido", "success");
          await load();
        } catch (err) {
          toast(err.message, "error");
          btn.disabled = false;
          btn.innerHTML = orig;
        } finally {
          input.value = "";
        }
      });
    });

    container.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const ok = await confirmDialog("¿Eliminar este documento?");
        if (!ok) return;
        try {
          await api.del(`/clients/${clientId}/documents/${btn.dataset.del}`);
          toast("Documento eliminado", "success");
          await load();
        } catch (err) {
          toast(err.message, "error");
        }
      })
    );
  }

  await load();
}
