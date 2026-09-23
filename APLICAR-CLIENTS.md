# APLICAR MOTOR DE CASO — clients.js

Archivo:
`creditflow/public/assets/js/sections/clients.js`

Haz SOLO estos 3 cambios.

## 1. Import

Junto a los imports del principio agrega:

```js
import { renderCaseEngine } from "./case-engine.js";
```

## 2. Contenedor

Dentro de `renderClientDetail`, justo DESPUÉS de:

```js
container.innerHTML = `
```

y antes del primer `<div class="grid grid-2">`, agrega:

```html
<div id="client-case-engine"></div>
```

La parte debe quedar así:

```js
container.innerHTML = `
    <div id="client-case-engine"></div>

    <div class="grid grid-2">
```

## 3. Activar el motor

Después de estas líneas:

```js
const itemsBox = document.getElementById("client-credit-items");
const earningsBox = document.getElementById("client-earnings");
renderClientCreditItems(itemsBox, id, earningsBox);
```

agrega:

```js
renderCaseEngine(document.getElementById("client-case-engine"), {
  client,
  onEdit: () => openClientModal(client, () => renderClientDetail(container, id)),
  onImportReport: () => document.getElementById("import-report-input")?.click(),
  onGenerateLetters: async () => {
    await runSmartGenerateForClient(id, () =>
      renderClientCreditItems(itemsBox, id, earningsBox)
    );
    await renderClientDetail(container, id);
  },
});
```

Eso es todo para `clients.js`.
