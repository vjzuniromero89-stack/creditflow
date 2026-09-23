import { api } from "../api.js";
import { icon } from "../icons.js";
import { toast } from "../toast.js";
import { escapeHtml } from "../utils.js";
import { renderTemplates as renderTemplatesBase } from "./templates.js";

export const PROFESSIONAL_TEMPLATE_LIBRARY = [
  {
    code: "01",
    name: "[PRO] 01 — Personal Information Correction",
    category: "01 — Identity & File Accuracy",
    recipient_hint: "Credit Reporting Company",
    subject: "Request to Correct Inaccurate Personal Identifying Information",
    phase: "Identity cleanup",
    trigger: "Wrong/foreign name, address, phone, DOB or mixed identifying information.",
    autoEligible: false,
    include_id_copy: true,
    include_address_proof: true,
    include_ssn_copy: false,
    body: `{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Correction of inaccurate personal identifying information

To Whom It May Concern:

I am writing to dispute personal identifying information appearing in my consumer file that is inaccurate, incomplete, or does not belong to me.

Correct identifying information:
Name: {{cliente_nombre}}
Current address: {{cliente_direccion}}, {{cliente_ciudad_estado_zip}}
Date of birth: {{cliente_fecha_nacimiento}}
Last four digits of identifying number: {{cliente_id_last4}}

Information I am disputing:
{{motivo_disputa}}

Please conduct a reasonable reinvestigation of the specific identifying information listed above and correct or remove information that is inaccurate or does not belong to me. I am enclosing copies of identification and proof of my current address to help identify my file.

Please send me the results and an updated copy of my consumer report.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code: "02",
    name: "[PRO] 02 — Mixed File Correction",
    category: "01 — Identity & File Accuracy",
    recipient_hint: "Credit Reporting Company",
    subject: "Possible Mixed File — Information Belonging to Another Consumer",
    phase: "Identity cleanup",
    trigger: "Accounts/identity data appear to belong to another consumer.",
    autoEligible: false,
    include_id_copy: true,
    include_address_proof: true,
    include_ssn_copy: false,
    body: `{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Possible mixed consumer file

To Whom It May Concern:

My consumer report appears to contain information that does not belong to me and may be associated with another consumer.

The specific information at issue is:
{{motivo_disputa}}

Please conduct a reasonable reinvestigation to ensure that my file contains only information that belongs to me. Please remove or correct information that cannot be matched to my identity accurately.

I have included identification and proof of current address to help distinguish my file from any other consumer.

Please send the results of your investigation and an updated report.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code: "10",
    name: "[PRO] 10 — CRA Factual Dispute — Initial",
    category: "10 — CRA Factual Disputes",
    recipient_hint: "Credit Reporting Company",
    subject: "Dispute of Inaccurate or Incomplete Credit Report Information",
    phase: "Initial factual dispute",
    trigger: "Specific inaccurate/incomplete account field supported by facts/evidence.",
    autoEligible: true,
    include_id_copy: true,
    include_address_proof: true,
    include_ssn_copy: false,
    body: `{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Credit report dispute — {{acreedor_nombre}} / {{numero_cuenta}}

To Whom It May Concern:

I am disputing specific information appearing in my consumer report because I believe it is inaccurate or incomplete.

Furnisher / account: {{acreedor_nombre}}
Account reference: {{numero_cuenta}}
Specific information disputed and basis:
{{motivo_disputa}}

Please conduct a reasonable reinvestigation of the specific information identified above, review all supporting documentation provided, and correct or delete any information that is inaccurate, incomplete, or cannot be verified.

Please provide me with the results of the reinvestigation and an updated copy of my consumer report.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code: "11",
    name: "[PRO] 11 — Unauthorized Inquiry Dispute",
    category: "11 — Inquiry",
    recipient_hint: "Credit Reporting Company",
    subject: "Dispute of Unrecognized / Unauthorized Inquiry",
    phase: "Inquiry review",
    trigger: "Consumer specifically confirms the inquiry was not authorized/recognized.",
    autoEligible: true,
    include_id_copy: true,
    include_address_proof: true,
    include_ssn_copy: false,
    body: `{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Inquiry dispute — {{acreedor_nombre}}

To Whom It May Concern:

I am disputing the inquiry identified below because I do not recognize or authorize it.

Company: {{acreedor_nombre}}
Reference / date information: {{numero_cuenta}}
Details:
{{motivo_disputa}}

Please investigate whether there was a permissible and authorized basis for this inquiry and correct or remove the inquiry if it was reported in error or does not belong to me.

Please send me the results of your investigation.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code: "12",
    name: "[PRO] 12 — Identity Theft Block — FCRA 605B",
    category: "12 — Identity Theft",
    recipient_hint: "Credit Reporting Company",
    subject: "Identity Theft Block Request",
    phase: "Identity theft",
    trigger: "Actual identity theft with Identity Theft Report and required supporting documents.",
    autoEligible: false,
    include_id_copy: true,
    include_address_proof: true,
    include_ssn_copy: true,
    body: `{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Identity theft block request

To Whom It May Concern:

I am a victim of identity theft. I am requesting that information resulting from identity theft be blocked from my consumer file.

Fraudulent information:
{{motivo_disputa}}

I am enclosing the documentation required to support this request, including proof of identity and my Identity Theft Report. The information identified above did not result from transactions made or authorized by me.

Please process this request under the identity-theft blocking provisions of the Fair Credit Reporting Act and provide written confirmation of the action taken.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code: "20",
    name: "[PRO] 20 — Debt Validation / Information Request",
    category: "20 — Debt Collector",
    recipient_hint: "Debt Collector",
    subject: "Dispute and Request for Debt Validation Information",
    phase: "Collector validation",
    trigger: "Collection agency is attempting to collect; timing and validation notice must be reviewed.",
    autoEligible: false,
    include_id_copy: false,
    include_address_proof: false,
    include_ssn_copy: false,
    body: `{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Alleged account {{numero_cuenta}}

To Whom It May Concern:

I am writing regarding the alleged debt referenced above. I dispute the debt as described below and request the validation information applicable to this account.

Original creditor / collector: {{acreedor_nombre}}
Account reference: {{numero_cuenta}}
Dispute / information requested:
{{motivo_disputa}}

Please provide the information necessary to identify the debt, the amount claimed, the current creditor, and the basis for claiming that I owe the debt. If this written dispute is received within an applicable validation period, please handle the account in accordance with the requirements that apply during that period.

This letter is not an acknowledgment of liability or a promise to pay.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code: "21",
    name: "[PRO] 21 — Direct Furnisher Dispute",
    category: "21 — Furnisher",
    recipient_hint: "Furnisher / Creditor",
    subject: "Direct Dispute of Furnished Credit Information",
    phase: "Furnisher investigation",
    trigger: "Specific account reporting field is inaccurate and direct-dispute requirements are satisfied.",
    autoEligible: false,
    include_id_copy: true,
    include_address_proof: false,
    include_ssn_copy: false,
    body: `{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Direct dispute — {{acreedor_nombre}} / {{numero_cuenta}}

To Whom It May Concern:

I am submitting a direct dispute concerning information your company furnished about the account referenced above.

Specific information disputed:
{{motivo_disputa}}

Please review the information and supporting documents provided, conduct a reasonable investigation, and correct any information that is inaccurate. If a correction is required, please notify each consumer reporting agency to which the inaccurate information was furnished.

Please send me the results of your investigation in writing.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code: "30",
    name: "[PRO] 30 — CRA Reinvestigation — New Evidence",
    category: "30 — Follow-up",
    recipient_hint: "Credit Reporting Company",
    subject: "Follow-up Dispute With New Relevant Information",
    phase: "Evidence-based follow-up",
    trigger: "Prior dispute completed but new relevant evidence or a materially different factual issue exists.",
    autoEligible: false,
    include_id_copy: true,
    include_address_proof: true,
    include_ssn_copy: false,
    body: `{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Follow-up dispute — {{acreedor_nombre}} / {{numero_cuenta}}

To Whom It May Concern:

I previously disputed information concerning the account above. I am submitting this follow-up because I now have new relevant information and/or a materially different factual basis that was not part of the prior dispute.

New information / unresolved factual issue:
{{motivo_disputa}}

Please conduct a reasonable reinvestigation considering the new information and supporting documentation. This is not a duplicate submission of the same dispute without new information.

Please send the results and an updated report.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code: "31",
    name: "[PRO] 31 — FCRA 611(a)(7) Procedure Description Request",
    category: "31 — Procedure Review",
    recipient_hint: "Credit Reporting Company",
    subject: "Request for Description of Reinvestigation Procedure",
    phase: "Procedure review",
    trigger: "CRA reports an item verified and the consumer wants the procedure used to determine accuracy/completeness.",
    autoEligible: false,
    include_id_copy: false,
    include_address_proof: false,
    include_ssn_copy: false,
    body: `{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Request for description of reinvestigation procedure — {{acreedor_nombre}} / {{numero_cuenta}}

To Whom It May Concern:

I received the results of a reinvestigation concerning the account identified above. The disputed information was reported as verified.

I am requesting a description of the procedure used to determine the accuracy and completeness of the disputed information, including the business name, address, and telephone number of each furnisher contacted, if reasonably available.

Account / dispute details:
{{motivo_disputa}}

Please send the requested information to my address above.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code: "32",
    name: "[PRO] 32 — Reinsertion Challenge",
    category: "32 — Reinsertion",
    recipient_hint: "Credit Reporting Company",
    subject: "Previously Deleted Information Has Reappeared",
    phase: "Reinsertion review",
    trigger: "CreditFlow history shows an item was removed and later reappeared.",
    autoEligible: true,
    include_id_copy: true,
    include_address_proof: true,
    include_ssn_copy: false,
    body: `{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Previously deleted information reappearing — {{acreedor_nombre}} / {{numero_cuenta}}

To Whom It May Concern:

The information identified above was previously removed from my consumer report after a dispute/reinvestigation, but it has appeared again.

Details:
{{motivo_disputa}}

Please investigate this reinsertion and provide the information and notices required when previously deleted information is reinserted, including the source of the reinserted information where applicable. If the reinsertion requirements were not satisfied or the information is inaccurate, please remove or correct it.

Please provide the results in writing.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code: "40",
    name: "[PRO] 40 — Goodwill Adjustment Request",
    category: "40 — Goodwill",
    recipient_hint: "Creditor / Lender",
    subject: "Goodwill Request Regarding Payment History",
    phase: "Goodwill",
    trigger: "Negative information appears accurate; consumer is requesting discretionary courtesy, not asserting a dispute.",
    autoEligible: false,
    include_id_copy: false,
    include_address_proof: false,
    include_ssn_copy: false,
    body: `{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Goodwill request — {{acreedor_nombre}} / {{numero_cuenta}}

To Whom It May Concern:

I am writing to request a discretionary goodwill adjustment concerning the payment history on the account above. I am not alleging that accurate information is erroneous.

Background:
{{motivo_disputa}}

I respectfully ask whether your company would consider making a goodwill adjustment based on my overall relationship, subsequent payment history, and the circumstances described above. I understand that this is a voluntary request.

Thank you for your consideration.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code: "41",
    name: "[PRO] 41 — Post-Payment / Settlement Reporting Correction",
    category: "41 — Account Status",
    recipient_hint: "Furnisher / Creditor",
    subject: "Request to Correct Balance or Status After Payment / Settlement",
    phase: "Status correction",
    trigger: "Account was paid/settled but balance or status is factually inconsistent with records.",
    autoEligible: false,
    include_id_copy: true,
    include_address_proof: false,
    include_ssn_copy: false,
    body: `{{fecha}}

{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

{{destinatario_nombre}}
{{destinatario_direccion}}

Re: Reporting correction — {{acreedor_nombre}} / {{numero_cuenta}}

To Whom It May Concern:

I am requesting an investigation and correction of the balance and/or status being furnished for the account above.

Specific discrepancy:
{{motivo_disputa}}

My supporting documentation reflects the payment, settlement, or account status described above. Please review the records and correct any inaccurate balance, status, or payment information furnished to consumer reporting agencies.

Please provide the results in writing.

Sincerely,

{{cliente_nombre}}`
  },
  {
    code: "50",
    name: "[PRO] 50 — CFPB Complaint Evidence Narrative",
    category: "50 — Escalation",
    recipient_hint: "CFPB Complaint",
    subject: "Credit Reporting Complaint — Documented Inaccuracy Not Resolved",
    phase: "Escalation",
    trigger: "Documented unresolved issue after appropriate dispute/investigation steps.",
    autoEligible: false,
    include_id_copy: false,
    include_address_proof: false,
    include_ssn_copy: false,
    body: `Consumer: {{cliente_nombre}}
Company involved: {{acreedor_nombre}}
Account / reference: {{numero_cuenta}}

What happened:
{{motivo_disputa}}

Prior steps taken:
- I reviewed the credit reporting at issue.
- I submitted a specific dispute and supporting information.
- I retained copies of correspondence, delivery/tracking records, and dispute results.
- The inaccurate or incomplete issue remains unresolved.

Resolution requested:
I am requesting that the company review the documented issue, explain the investigation performed, and correct or delete information that is inaccurate, incomplete, or cannot be verified.

Documents to attach:
- Relevant report pages
- Prior dispute correspondence
- Supporting evidence
- Delivery/tracking confirmation
- Investigation results / response
- Updated report showing the unresolved issue`
  },
];

function strategyMapHtml() {
  const phases = [
    ["1", "Audit", "Compare identity, accounts, balances, dates, ownership and bureau differences."],
    ["2", "Identity cleanup", "Correct only inaccurate/mixed identifying information; do not delete accurate history just because it is old."],
    ["3", "Fraud protection", "Use freezes/fraud tools for security or actual identity-theft risk — not to obstruct verification."],
    ["4", "Factual dispute", "Send a specific, evidence-backed CRA dispute for each actual error."],
    ["5", "Response analysis", "Wait for investigation/delivery, read the result, and classify deleted / corrected / verified / incomplete response."],
    ["6", "Targeted follow-up", "New evidence, procedure request, furnisher dispute, validation request, goodwill or reinsertion — whichever fits."],
    ["7", "Escalation", "Use a documented evidence package for unresolved inaccuracies; never send a duplicate 'stronger round' with no new basis."],
  ];
  return phases.map(([n,t,d]) => `
    <div class="pro-phase">
      <span>${n}</span>
      <div><strong>${t}</strong><p>${d}</p></div>
    </div>`).join("");
}

async function installProfessionalLibrary(btn, rerender) {
  btn.disabled = true;
  const old = btn.innerHTML;
  btn.innerHTML = `${icon("spark")} Instalando…`;
  try {
    const { templates } = await api.get("/templates");
    const names = new Set((templates || []).map((t) => t.name));
    let created = 0;
    for (const t of PROFESSIONAL_TEMPLATE_LIBRARY) {
      if (names.has(t.name)) continue;
      await api.post("/templates", {
        name: t.name,
        category: t.category,
        recipient_hint: t.recipient_hint,
        subject: t.subject,
        body: t.body,
        include_id_copy: !!t.include_id_copy,
        include_address_proof: !!t.include_address_proof,
        include_ssn_copy: !!t.include_ssn_copy,
      });
      created++;
    }
    toast(created ? `${created} plantilla(s) profesional(es) instalada(s)` : "La biblioteca profesional ya está completa", "success");
    await rerender();
  } catch (err) {
    toast(err.message, "error");
  } finally {
    btn.disabled = false;
    btn.innerHTML = old;
  }
}

export async function renderTemplates(container) {
  container.innerHTML = `<div class="card">Cargando estrategia…</div>`;
  const { templates = [] } = await api.get("/templates");
  const installed = PROFESSIONAL_TEMPLATE_LIBRARY.filter((p) => templates.some((t) => t.name === p.name)).length;

  const base = document.createElement("div");
  base.id = "professional-template-library-base";
  container.innerHTML = `
    <section class="pro-strategy-hero">
      <div>
        <div class="pro-eyebrow">CreditFlow Strategy OS</div>
        <h2>Estrategia profesional de reparación de crédito</h2>
        <p>Las cartas son herramientas dentro de un proceso de investigación. La app debe decidir por hechos, evidencia y respuesta recibida — no por repetir rondas genéricas.</p>
      </div>
      <div class="pro-library-status">
        <strong>${installed}/${PROFESSIONAL_TEMPLATE_LIBRARY.length}</strong>
        <span>plantillas profesionales instaladas</span>
        <button class="btn btn-primary" id="install-pro-library">${icon("spark")} Instalar / completar biblioteca</button>
      </div>
    </section>

    <section class="pro-strategy-map">
      ${strategyMapHtml()}
    </section>

    <section class="pro-rules card">
      <div>
        <strong>Reglas que CreditFlow debe respetar</strong>
        <p>No disputar información solo porque es negativa · no usar identity theft sin fraude real · no generar Round 2 duplicado · no usar freezes para obstaculizar verificaciones · toda escalación debe conservar evidencia y tracking.</p>
      </div>
    </section>

    <section class="pro-library-grid">
      ${PROFESSIONAL_TEMPLATE_LIBRARY.map((t) => `
        <article class="pro-template-card ${templates.some((x)=>x.name===t.name) ? "installed" : ""}">
          <div class="pro-template-code">${t.code}</div>
          <div>
            <strong>${escapeHtml(t.name.replace("[PRO] ", ""))}</strong>
            <span>${escapeHtml(t.phase)}</span>
            <p>${escapeHtml(t.trigger)}</p>
          </div>
          <div class="pro-auto ${t.autoEligible ? "yes" : "review"}">${t.autoEligible ? "Draft automático permitido" : "Revisión humana requerida"}</div>
        </article>
      `).join("")}
    </section>

    <div class="pro-existing-library-head">
      <div>
        <h2>Biblioteca de plantillas</h2>
        <p>Aquí siguen tus plantillas actuales y las profesionales instaladas.</p>
      </div>
    </div>
  `;
  container.appendChild(base);

  await renderTemplatesBase(base);

  document.getElementById("install-pro-library")?.addEventListener("click", (e) =>
    installProfessionalLibrary(e.currentTarget, () => renderTemplates(container))
  );
}
