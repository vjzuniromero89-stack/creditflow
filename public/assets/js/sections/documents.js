import { api } from "../api.js";
import { icon } from "../icons.js";
import { toast } from "../toast.js";
import { confirmDialog, openModal } from "../modal.js";
import { formatDate, escapeHtml } from "../utils.js";

export const DOC_META = {
  id: {
    label: "Identificación (ID)",
    hint: "Licencia, pasaporte o ID estatal — clara, completa y sin reflejos.",
  },
  proof_address: {
    label: "Comprobante de domicilio",
    hint: "Bill reciente a nombre del cliente y con la dirección actual.",
  },
  ssn: {
    label: "Social Security",
    hint: "Foto clara de la tarjeta de Social Security.",
  },
};

function valueRow(label, value) {
  return `
    <div class="ai-doc-field">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value || "No detectado")}</strong>
    </div>`;
}

function mergeClientWithId(client, fields, overwrite) {
  const pick = (key) => {
    const extracted = fields[key];
    if (!extracted) return client[key] || "";
    if (overwrite) return extracted;
    return client[key] || extracted;
  };
  return {
    full_name: pick("full_name"),
    email: client.email || "",
    phone: client.phone || "",
    address: pick("address"),
    city: pick("city"),
    state: pick("state"),
    zip: pick("zip"),
    id_last4: pick("id_last4"),
    date_of_birth: pick("date_of_birth"),
    ssn_full: "",
    status: client.status || "activo",
    notes: client.notes || "",
  };
}

async function analyzeStoredId(clientId, documentId) {
  const res = await fetch(`/api/clients/${clientId}/documents/${documentId}/file`, {
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error("No se pudo leer la imagen guardada del ID.");
  const blob = await res.blob();
  const file = new File([blob], "identificacion.jpg", { type: blob.type || "image/jpeg" });
  const fd = new FormData();
  fd.append("file", file);
  return api.upload("/clients/extract-id", fd);
}

export async function renderClientDocuments(container, clientId) {
  async function load() {
    const [{ documents }, { client }] = await Promise.all([
      api.get(`/clients/${clientId}/documents`),
      api.get(`/clients/${clientId}`),
    ]);
    draw(documents, client);
  }

  function draw(documents, client) {
    container.innerHTML = `
      <div class="automation-doc-banner">
        <div>
          <strong>Documentos inteligentes</strong>
          <p>El ID puede volver a analizarse con IA para completar automáticamente los datos que falten del cliente.</p>
        </div>
        <span class="badge badge-activo">IA</span>
      </div>

      <div class="grid grid-2">
        ${Object.entries(DOC_META)
          .map(([type, meta]) => {
            const doc = documents.find((d) => d.doc_type === type);
            return `
              <div class="card automation-doc-card" data-type="${type}">
                <div class="flex-between" style="margin-bottom:8px">
                  <h4 style="font-size:14px">${meta.label}</h4>
                  <span class="badge ${doc ? "badge-completada" : "badge-otro"}">${doc ? "Subido" : "Falta"}</span>
                </div>
                <p class="text-sm text-muted" style="margin-bottom:10px">${meta.hint}</p>
                ${
                  doc
                    ? `<img src="/api/clients/${clientId}/documents/${doc.id}/file" class="doc-thumb automation-doc-thumb" alt="${escapeHtml(meta.label)}" />`
                    : ""
                }
                ${doc ? `<div class="text-sm text-muted" style="margin:8px 0">Subido ${formatDate(doc.updated_at)}</div>` : ""}
                <div class="flex gap-8 automation-doc-actions" style="margin-top:8px;flex-wrap:wrap">
                  <input type="file" accept="image/jpeg,image/png,image/webp" data-file-input="${type}" style="display:none" />
                  <button class="btn btn-ghost btn-sm" data-upload="${type}">
                    ${icon("upload")} ${doc ? "Reemplazar" : "Subir"}
                  </button>
                  ${
                    type === "id" && doc
                      ? `<button class="btn btn-primary btn-sm" data-analyze-id="${doc.id}">${icon("spark")} Analizar ID y completar datos</button>`
                      : ""
                  }
                  ${doc ? `<button class="btn btn-danger btn-sm btn-icon" data-del="${doc.id}">${icon("trash")}</button>` : ""}
                </div>
              </div>`;
          })
          .join("")}
      </div>

      <p class="text-sm text-muted" style="margin-top:10px">
        Antes de preparar correspondencia, CreditFlow debe tener ID y comprobante de domicilio.
        La IA ayuda a capturar datos, pero los valores detectados se muestran antes de reemplazar datos existentes.
      </p>
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

    container.querySelectorAll("[data-analyze-id]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        const orig = btn.innerHTML;
        btn.innerHTML = "Analizando…";
        try {
          const { fields } = await analyzeStoredId(clientId, btn.dataset.analyzeId);
          const detected = fields || {};
          const { close, body } = openModal({
            title: "Datos detectados en el ID",
            wide: true,
            bodyHtml: `
              <div class="ai-doc-results">
                ${valueRow("Nombre completo", detected.full_name)}
                ${valueRow("Dirección", detected.address)}
                ${valueRow("Ciudad", detected.city)}
                ${valueRow("Estado", detected.state)}
                ${valueRow("ZIP", detected.zip)}
                ${valueRow("Fecha de nacimiento", detected.date_of_birth)}
                ${valueRow("Últimos 4 del ID", detected.id_last4)}
              </div>
              <div class="automation-warning">
                Los campos que la IA no pudo leer quedan intactos. Puedes completar solamente los campos vacíos
                o reemplazar los datos actuales con los valores detectados.
              </div>
              <div class="form-actions">
                <button class="btn btn-ghost" type="button" data-cancel>Cerrar</button>
                <button class="btn btn-ghost" type="button" data-fill-empty>Completar solo vacíos</button>
                <button class="btn btn-primary" type="button" data-overwrite>Usar datos detectados</button>
              </div>`,
          });

          body.querySelector("[data-cancel]").addEventListener("click", close);

          async function apply(overwrite) {
            const payload = mergeClientWithId(client, detected, overwrite);
            if (!payload.full_name) return toast("No se detectó un nombre válido.", "error");
            try {
              await api.put(`/clients/${clientId}`, payload);
              toast(overwrite ? "Datos del cliente actualizados desde el ID" : "Campos vacíos completados desde el ID", "success");
              close();
              await load();
            } catch (err) {
              toast(err.message, "error");
            }
          }

          body.querySelector("[data-fill-empty]").addEventListener("click", () => apply(false));
          body.querySelector("[data-overwrite]").addEventListener("click", async () => {
            const ok = await confirmDialog("¿Reemplazar los datos actuales del cliente con los valores detectados en el ID?");
            if (ok) apply(true);
          });
        } catch (err) {
          toast(err.message, "error");
        } finally {
          btn.disabled = false;
          btn.innerHTML = orig;
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
