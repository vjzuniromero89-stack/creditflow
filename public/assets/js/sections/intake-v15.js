import { api } from "../api.js";
export async function bootIntake(){
 const root=document.getElementById("root"),token=(location.hash.split("/intake/")[1]||"").split("/")[0];
 let info;try{info=await api.get(`/intake/${encodeURIComponent(token)}`)}catch(e){root.innerHTML=`<div class="auth-screen"><div class="auth-card"><h2>Link no disponible</h2><p>${e.message}</p></div></div>`;return}
 root.innerHTML=`<div class="auth-screen"><div class="auth-card" style="max-width:720px;width:100%"><div class="cf7-brand" style="margin-bottom:20px"><div class="cf7-brand-mark">CF</div><div><strong>CreditFlow</strong><span>Registro seguro del cliente</span></div></div>
 <h2>Completa tu información</h2><p class="text-muted">La información y documentos se guardarán directamente en tu expediente.</p>
 <form id="intake-form" class="form-grid" enctype="multipart/form-data">
  <label>Nombre completo<input name="full_name" required value="${info.full_name||""}"></label>
  <label>Teléfono<input name="phone" required value="${info.phone||""}"></label>
  <label>Correo electrónico<input name="email" type="email" required value="${info.email||""}"></label>
  <label>Últimos 4 del Social<input name="id_last4" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" required value="${info.id_last4||""}"></label>
  <label style="grid-column:1/-1">Dirección<input name="address" required value="${info.address||""}"></label>
  <label>Ciudad<input name="city" required value="${info.city||""}"></label><label>Estado<input name="state" maxlength="2" required value="${info.state||""}"></label><label>ZIP<input name="zip" required value="${info.zip||""}"></label>
  <label>Foto de identificación<input name="id_file" type="file" accept="image/jpeg,image/png,image/webp" ${info.has_id?"":"required"}></label>
  <label>Foto de bill / comprobante de domicilio<input name="bill_file" type="file" accept="image/jpeg,image/png,image/webp" ${info.has_bill?"":"required"}></label>
  <button class="btn btn-primary" style="grid-column:1/-1" type="submit">Guardar mi información</button>
 </form><div id="intake-msg"></div></div></div>`;
 document.getElementById("intake-form").onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;b.textContent="Guardando…";try{const fd=new FormData(e.currentTarget);await api.upload(`/intake/${encodeURIComponent(token)}`,fd);root.innerHTML=`<div class="auth-screen"><div class="auth-card"><h2>✓ Información recibida</h2><p>Tu expediente fue actualizado correctamente. Ya puedes cerrar esta página.</p></div></div>`}catch(err){document.getElementById("intake-msg").innerHTML=`<div class="auth-error">${err.message}</div>`;b.disabled=false;b.textContent="Guardar mi información"}};
}
