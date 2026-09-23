import { icon } from "./icons.js";

export function openModal({ title, bodyHtml, wide = false }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal ${wide ? "modal-wide" : ""}" role="dialog" aria-modal="true">
      <div class="modal-head">
        <h3>${title}</h3>
        <button class="modal-close" type="button" data-close>${icon("x")}</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector("[data-close]").addEventListener("click", close);
  document.addEventListener(
    "keydown",
    function onEsc(e) {
      if (e.key === "Escape") {
        close();
        document.removeEventListener("keydown", onEsc);
      }
    },
    { once: true }
  );

  return { overlay, close, body: overlay.querySelector(".modal-body") };
}

export function confirmDialog(message) {
  return new Promise((resolve) => {
    const { overlay, close } = openModal({
      title: "Confirmar",
      bodyHtml: `
        <p class="text-muted" style="margin-bottom:20px">${message}</p>
        <div class="form-actions">
          <button class="btn btn-ghost" data-cancel type="button">Cancelar</button>
          <button class="btn btn-danger" data-ok type="button">Sí, continuar</button>
        </div>
      `,
    });
    overlay.querySelector("[data-cancel]").addEventListener("click", () => {
      close();
      resolve(false);
    });
    overlay.querySelector("[data-ok]").addEventListener("click", () => {
      close();
      resolve(true);
    });
  });
}
