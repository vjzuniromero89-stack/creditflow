import { api } from "../api.js";
import {
  renderClientsList as renderClientsListBase,
  renderClientDetail as renderClientDetailBase,
} from "./clients.js";
import { renderCaseEngine } from "./case-engine.js";
import { runSmartGenerateForClient } from "./collections.js";

export async function renderClientsList(container) {
  return renderClientsListBase(container);
}

export async function renderClientDetail(container, id) {
  await renderClientDetailBase(container, id);

  let holder = document.getElementById("client-case-engine");
  if (!holder) {
    holder = document.createElement("div");
    holder.id = "client-case-engine";
    container.prepend(holder);
  }

  const { client } = await api.get(`/clients/${id}`);

  await renderCaseEngine(holder, {
    client,
    onEdit: () => {
      document.getElementById("edit-client")?.click();
    },
    onImportReport: () => {
      document.getElementById("import-report-input")?.click();
    },
    onGenerateLetters: async () => {
      await runSmartGenerateForClient(id, () => {});
      await renderClientDetail(container, id);
    },
  });
}
