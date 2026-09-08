/* =====================================================================
   CreditFlow — Worker de Cloudflare Workers (Wrangler + Workers Assets)
   Todo el backend vive en este único archivo porque así nació el
   proyecto (cuando corría como Cloudflare Pages Functions en modo
   "Advanced Mode"): se mantiene como un solo archivo al migrarlo a
   Wrangler para no reescribir ni dividir código que ya funciona.

   Base de datos: usa Supabase (Postgres) en vez de D1. `env.DB` se
   arma en el fetch() de más abajo con el shim de db-shim.js, que
   implementa la misma API de D1 (`prepare().bind().first()/.all()/.run()`)
   por encima de Supabase, así que el resto de este archivo no cambió.
   ===================================================================== */

import { createD1Shim } from "./db-shim.js";

/* ---------------------------- Utilidades HTTP ---------------------------- */

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
  });
}

function errorJson(message, status = 400, extra = {}) {
  return json({ error: message, ...extra }, status);
}

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const out = {};
  header.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  });
  return out;
}

function sessionCookieHeader(token, maxAgeSeconds = 60 * 60 * 24 * 14) {
  return `session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

function clearSessionCookieHeader() {
  return `session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function logActivity(db, { entityType, entityId, action, detail, userId }) {
  try {
    await db
      .prepare(`INSERT INTO activity_log (entity_type, entity_id, action, detail, user_id) VALUES (?, ?, ?, ?, ?)`)
      .bind(entityType, entityId, action, detail || null, userId || null)
      .run();
  } catch (e) {
    console.error("activity_log error", e);
  }
}

/* --------------------------- Criptografía (Web Crypto) --------------------------- */

function bufToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  return bytes.buffer;
}
function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  let out = "";
  for (let i = 0; i < bin.length; i++) out += String.fromCharCode(bin.charCodeAt(i));
  return out;
}
const PBKDF2_ITERATIONS = 100000;

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", salt, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, keyMaterial, 256);
  return { hash: bufToHex(derived), salt: bufToHex(salt.buffer) };
}
async function verifyPassword(password, hash, saltHex) {
  const salt = hexToBuf(saltHex);
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), { name: "PBKDF2" }, false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: new Uint8Array(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" }, keyMaterial, 256);
  const computed = bufToHex(derived);
  if (computed.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
// Genera una contraseña aleatoria legible (sin caracteres ambiguos como 0/O, 1/l/I) para el
// acceso del cliente a su portal — se muestra en texto plano UNA sola vez al crearse o al
// regenerarse, nunca se vuelve a poder leer después (solo se guarda su hash).
function randomPortalPassword(len = 10) {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}
function slugifyUsername(fullName) {
  const base = String(fullName || "cliente")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s.]/g, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(".");
  return base || "cliente";
}
async function generateUniquePortalUsername(env, fullName) {
  const base = slugifyUsername(fullName);
  let candidate = base;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const existing = await env.DB.prepare(`SELECT id FROM clients WHERE portal_username = ?`).bind(candidate).first();
    if (!existing) return candidate;
    n += 1;
    candidate = `${base}${n}`;
  }
}
// Crea (o regenera) el acceso al portal de un cliente: usuario único derivado de su nombre y una
// contraseña aleatoria. Devuelve la contraseña EN TEXTO PLANO — es responsabilidad de quien llama
// mostrarla una sola vez al usuario (admin) y no guardarla en ningún lado; en la base de datos solo
// queda el hash.
async function assignPortalCredentials(env, clientId, fullName, keepUsername) {
  const username = keepUsername || (await generateUniquePortalUsername(env, fullName));
  const password = randomPortalPassword(10);
  const { hash, salt } = await hashPassword(password);
  await env.DB.prepare(`UPDATE clients SET portal_username = ?, portal_password_hash = ?, portal_password_salt = ? WHERE id = ?`).bind(username, hash, salt, clientId).run();
  return { username, password };
}
// Nunca se debe devolver portal_password_hash/portal_password_salt al frontend — se quitan de
// cualquier fila de cliente antes de mandarla en una respuesta JSON.
function sanitizeClient(c) {
  if (!c) return c;
  const { portal_password_hash, portal_password_salt, ...rest } = c;
  return rest;
}

async function hmacSign(message, secret) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return b64urlEncode(String.fromCharCode(...new Uint8Array(sig)));
}
async function createToken(payload, secret, ttlSeconds = 60 * 60 * 24 * 14) {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const encoded = b64urlEncode(JSON.stringify(body));
  const sig = await hmacSign(encoded, secret);
  return `${encoded}.${sig}`;
}
async function verifyToken(token, secret) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [encoded, sig] = token.split(".");
  const expectedSig = await hmacSign(encoded, secret);
  if (sig !== expectedSig) return null;
  try {
    const payload = JSON.parse(b64urlDecode(encoded));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

/* ------------------------------ USPS (opcional) ------------------------------ */

const USPS_TOKEN_URL = "https://apis.usps.com/oauth2/v3/token";
const USPS_TRACKING_URL = (n) => `https://apis.usps.com/tracking/v3/tracking/${encodeURIComponent(n)}?expand=DETAIL`;

async function uspsGetAccessToken(env) {
  const res = await fetch(USPS_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: env.USPS_CLIENT_ID, client_secret: env.USPS_CLIENT_SECRET, grant_type: "client_credentials", scope: "tracking" }),
  });
  if (!res.ok) throw new Error(`USPS OAuth falló (${res.status})`);
  const data = await res.json();
  return data.access_token;
}
function uspsMapStatus(raw) {
  const text = JSON.stringify(raw).toLowerCase();
  if (text.includes("delivered")) return "entregada";
  if (text.includes("returned") || text.includes("undeliverable") || text.includes("return to sender")) return "devuelta";
  if (text.includes("out for delivery") || text.includes("in transit") || text.includes("arrived") || text.includes("departed")) return "en_transito";
  if (text.includes("accepted") || text.includes("acceptance") || text.includes("pre-shipment")) return "enviada";
  return null;
}
function uspsExtractSummary(raw) {
  return raw?.status || raw?.statusSummary || raw?.statusCategory || raw?.trackingEvents?.[0]?.eventType || "Sin detalle disponible";
}
async function fetchTrackingStatus(env, trackingNumber) {
  if (!env.USPS_CLIENT_ID || !env.USPS_CLIENT_SECRET) return { configured: false };
  const token = await uspsGetAccessToken(env);
  const res = await fetch(USPS_TRACKING_URL(trackingNumber), { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`USPS Tracking API falló (${res.status}): ${text.slice(0, 200)}`);
  }
  const raw = await res.json();
  return { configured: true, mappedStatus: uspsMapStatus(raw), summary: uspsExtractSummary(raw), raw };
}

/* ================================ AUTH / SETUP ================================ */

async function authStatus(request, env) {
  const { count } = (await env.DB.prepare(`SELECT COUNT(*) as count FROM users`).first()) || { count: 0 };
  let user = null;
  if (env.SESSION_SECRET) {
    const cookies = parseCookies(request);
    const payload = await verifyToken(cookies.session, env.SESSION_SECRET);
    if (payload) user = { id: payload.uid, username: payload.username, full_name: payload.full_name, role: payload.role };
  }
  return json({ needsSetup: count === 0, authenticated: !!user, user, uspsConfigured: !!(env.USPS_CLIENT_ID && env.USPS_CLIENT_SECRET) });
}

async function authLogin(request, env) {
  if (!env.SESSION_SECRET) return errorJson("Falta configurar la variable de entorno SESSION_SECRET en este Worker de Cloudflare.", 500);
  const body = await readJson(request);
  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";
  if (!username || !password) return errorJson("Usuario y contraseña son requeridos.");
  const u = await env.DB.prepare(`SELECT * FROM users WHERE username = ?`).bind(username).first();
  if (!u) return errorJson("Usuario o contraseña incorrectos.", 401);
  const ok = await verifyPassword(password, u.password_hash, u.password_salt);
  if (!ok) return errorJson("Usuario o contraseña incorrectos.", 401);
  const token = await createToken({ uid: u.id, username: u.username, full_name: u.full_name, role: u.role }, env.SESSION_SECRET);
  await logActivity(env.DB, { entityType: "user", entityId: u.id, action: "inicio_sesion", userId: u.id });
  return json({ user: { id: u.id, username: u.username, full_name: u.full_name, role: u.role } }, 200, { "Set-Cookie": sessionCookieHeader(token) });
}

async function authLogout() {
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookieHeader() });
}

async function changePassword(request, env, user) {
  const body = await readJson(request);
  const currentPassword = body.current_password || "";
  const newPassword = body.new_password || "";
  if (newPassword.length < 8) return errorJson("La nueva contraseña debe tener al menos 8 caracteres.");
  const u = await env.DB.prepare(`SELECT * FROM users WHERE id = ?`).bind(user.uid).first();
  if (!u) return errorJson("Usuario no encontrado.", 404);
  const ok = await verifyPassword(currentPassword, u.password_hash, u.password_salt);
  if (!ok) return errorJson("La contraseña actual no es correcta.", 401);
  const { hash, salt } = await hashPassword(newPassword);
  await env.DB.prepare(`UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?`).bind(hash, salt, u.id).run();
  await logActivity(env.DB, { entityType: "user", entityId: u.id, action: "cambio_password", userId: u.id });
  return json({ ok: true });
}

async function listUsers(env) {
  const { results } = await env.DB.prepare(`SELECT id, username, full_name, role, created_at FROM users ORDER BY created_at ASC`).all();
  return json({ users: results || [] });
}

async function createUser(request, env, user) {
  if (user.role !== "admin") return errorJson("Solo un administrador puede crear usuarios.", 403);
  const body = await readJson(request);
  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";
  const fullName = (body.full_name || "").trim();
  const role = body.role === "admin" ? "admin" : "agente";
  if (username.length < 3) return errorJson("El usuario debe tener al menos 3 caracteres.");
  if (password.length < 8) return errorJson("La contraseña debe tener al menos 8 caracteres.");
  const existing = await env.DB.prepare(`SELECT id FROM users WHERE username = ?`).bind(username).first();
  if (existing) return errorJson("Ese nombre de usuario ya existe.");
  const { hash, salt } = await hashPassword(password);
  const result = await env.DB.prepare(`INSERT INTO users (username, password_hash, password_salt, full_name, role) VALUES (?, ?, ?, ?, ?)`)
    .bind(username, hash, salt, fullName || username, role)
    .run();
  await logActivity(env.DB, { entityType: "user", entityId: result.meta.last_row_id, action: "usuario_creado", detail: username, userId: user.uid });
  return json({ id: result.meta.last_row_id, username, full_name: fullName || username, role });
}

async function setupInit(request, env) {
  if (!env.SESSION_SECRET) return errorJson("Falta configurar la variable de entorno SESSION_SECRET en este Worker de Cloudflare.", 500);
  const { count } = (await env.DB.prepare(`SELECT COUNT(*) as count FROM users`).first()) || { count: 0 };
  if (count > 0) return errorJson("Ya existe un administrador configurado. Inicia sesión normalmente.", 403);
  const body = await readJson(request);
  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";
  const fullName = (body.full_name || "").trim();
  if (username.length < 3) return errorJson("El usuario debe tener al menos 3 caracteres.");
  if (password.length < 8) return errorJson("La contraseña debe tener al menos 8 caracteres.");
  const { hash, salt } = await hashPassword(password);
  const result = await env.DB.prepare(`INSERT INTO users (username, password_hash, password_salt, full_name, role) VALUES (?, ?, ?, ?, 'admin')`)
    .bind(username, hash, salt, fullName || username)
    .run();
  const uid = result.meta.last_row_id;
  const token = await createToken({ uid, username, full_name: fullName || username, role: "admin" }, env.SESSION_SECRET);
  await logActivity(env.DB, { entityType: "user", entityId: uid, action: "setup_inicial", detail: `Cuenta de administrador creada (${username})`, userId: uid });
  return json({ user: { id: uid, username, full_name: fullName || username, role: "admin" } }, 200, { "Set-Cookie": sessionCookieHeader(token) });
}

/* ============================ PORTAL DEL CLIENTE ============================
   Acceso separado del de tu equipo: cada cliente entra con su propio usuario y
   contraseña (creados automáticamente cuando lo agregas — ver clientCreate) a
   una vista de solo lectura de SU caso. Usa su propia cookie ("portal_session",
   distinta de "session" que usa tu equipo) para que nunca se mezclen las dos
   sesiones en el mismo navegador. El portal jamás expone tarifas/precios — esa
   información es solo tuya y vive en Ganancias.
   ============================================================================ */

function portalSessionCookieHeader(token, maxAgeSeconds = 60 * 60 * 24 * 30) {
  return `portal_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}
function clearPortalSessionCookieHeader() {
  return `portal_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function portalStatus(request, env) {
  let client = null;
  if (env.SESSION_SECRET) {
    const cookies = parseCookies(request);
    const payload = await verifyToken(cookies.portal_session, env.SESSION_SECRET);
    if (payload && payload.type === "client_portal") client = { id: payload.cid, full_name: payload.full_name };
  }
  return json({ authenticated: !!client, client });
}

async function portalLogin(request, env) {
  if (!env.SESSION_SECRET) return errorJson("Falta configurar la variable de entorno SESSION_SECRET en este Worker de Cloudflare.", 500);
  const body = await readJson(request);
  const username = (body.username || "").trim().toLowerCase();
  const password = body.password || "";
  if (!username || !password) return errorJson("Usuario y contraseña son requeridos.");
  const c = await env.DB.prepare(`SELECT * FROM clients WHERE portal_username = ?`).bind(username).first();
  if (!c || !c.portal_password_hash) return errorJson("Usuario o contraseña incorrectos.", 401);
  const ok = await verifyPassword(password, c.portal_password_hash, c.portal_password_salt);
  if (!ok) return errorJson("Usuario o contraseña incorrectos.", 401);
  const token = await createToken({ cid: c.id, username: c.portal_username, full_name: c.full_name, type: "client_portal" }, env.SESSION_SECRET, 60 * 60 * 24 * 30);
  await logActivity(env.DB, { entityType: "client", entityId: c.id, action: "portal_inicio_sesion" });
  return json({ client: { id: c.id, full_name: c.full_name } }, 200, { "Set-Cookie": portalSessionCookieHeader(token) });
}

async function portalLogout() {
  return json({ ok: true }, 200, { "Set-Cookie": clearPortalSessionCookieHeader() });
}

// Vista de "cómo va mi proceso" para el cliente: sus ítems de crédito agrupados por categoría
// (sin ningún precio/tarifa — esa información es solo del negocio) y su historial de direcciones.
// Por cada ítem se muestra si sigue reportando o ya se borró, y cuántas cartas se le han enviado,
// para que el cliente vea el progreso sin ver nada financiero interno.
async function portalCase(env, clientId) {
  const client = await env.DB.prepare(`SELECT id, full_name, status, created_at FROM clients WHERE id = ?`).bind(clientId).first();
  if (!client) return errorJson("Cliente no encontrado.", 404);
  const { results: itemsRaw } = await env.DB.prepare(
    `SELECT ci.id, ci.category, ci.creditor_name, ci.account_number, ci.balance, ci.bureaus, ci.removed_status, ci.is_disputed,
       (SELECT COUNT(*) FROM letters l WHERE l.credit_item_id = ci.id) as letters_count
     FROM credit_items ci WHERE ci.client_id = ? ORDER BY ci.created_at DESC`
  ).bind(clientId).all();
  const items = (itemsRaw || []).map((it) => ({ ...it, bureau_count: bureauCountForItem(it.bureaus), category_label: PRICING_CATEGORY_LABEL[it.category] || it.category }));
  const { results: addresses } = await env.DB.prepare(
    `SELECT id, address_line, status, bureaus, first_reported, last_reported FROM client_addresses WHERE client_id = ? ORDER BY (status = 'eliminada'), last_reported DESC, id DESC`
  ).bind(clientId).all();
  return json({ client, items, addresses: addresses || [] });
}

async function routePortalApi(request, env, path, portal) {
  const method = request.method;
  if (path === "/api/portal/case" && method === "GET") return portalCase(env, portal.cid);
  return errorJson("Ruta no encontrada.", 404);
}

async function handlePortalRequest(request, env, path) {
  const method = request.method;
  if (path === "/api/portal/login" && method === "POST") return portalLogin(request, env);
  if (path === "/api/portal/status" && method === "GET") return portalStatus(request, env);
  if (path === "/api/portal/logout" && method === "POST") return portalLogout();
  if (!env.SESSION_SECRET) return errorJson("Falta configurar la variable de entorno SESSION_SECRET en este Worker de Cloudflare.", 500);
  const cookies = parseCookies(request);
  const payload = await verifyToken(cookies.portal_session, env.SESSION_SECRET);
  if (!payload || payload.type !== "client_portal") return errorJson("No has iniciado sesión.", 401);
  try {
    return await routePortalApi(request, env, path, payload);
  } catch (e) {
    console.error(e);
    return errorJson(`Error interno: ${e.message}`, 500);
  }
}

/* ================================ CLIENTES ================================ */

async function clientsList(request, env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") || "").trim();
  const status = url.searchParams.get("status");
  let sql = `SELECT c.*, (SELECT COUNT(*) FROM letters l WHERE l.client_id = c.id) AS letters_count,
    (SELECT COUNT(*) FROM letters l WHERE l.client_id = c.id AND l.status NOT IN ('completada','entregada')) AS letters_active
    FROM clients c WHERE 1=1`;
  const params = [];
  if (q) {
    sql += ` AND (LOWER(c.full_name) LIKE ? OR LOWER(c.email) LIKE ? OR c.phone LIKE ?)`;
    const like = `%${q.toLowerCase()}%`;
    params.push(like, like, like);
  }
  if (status) {
    sql += ` AND c.status = ?`;
    params.push(status);
  }
  sql += ` ORDER BY c.created_at DESC`;
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return json({ clients: (results || []).map(sanitizeClient) });
}

async function clientCreate(request, env, user) {
  const body = await readJson(request);
  const fullName = (body.full_name || "").trim();
  if (!fullName) return errorJson("El nombre del cliente es requerido.");
  const result = await env.DB.prepare(
    `INSERT INTO clients (full_name, email, phone, address, city, state, zip, id_last4, date_of_birth, status, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(fullName, body.email || null, body.phone || null, body.address || null, body.city || null, body.state || null, body.zip || null, body.id_last4 || null, body.date_of_birth || null, body.status || "activo", body.notes || null)
    .run();
  const id = result.meta.last_row_id;
  await logActivity(env.DB, { entityType: "client", entityId: id, action: "cliente_creado", detail: fullName, userId: user.uid });
  // Cada cliente nace con acceso a su propio portal (usuario/contraseña separados de los de tu
  // equipo) para que pueda entrar a ver cómo va su proceso. La contraseña solo se puede leer
  // ahora, en texto plano — después solo queda su hash.
  const { username: portal_username, password: portal_password_plain } = await assignPortalCredentials(env, id, fullName);
  await logActivity(env.DB, { entityType: "client", entityId: id, action: "portal_acceso_creado", detail: portal_username, userId: user.uid });
  const client = await env.DB.prepare(`SELECT * FROM clients WHERE id = ?`).bind(id).first();
  return json({ client: sanitizeClient(client), portal_username, portal_password_plain });
}

async function clientGet(env, id) {
  const client = await env.DB.prepare(`SELECT * FROM clients WHERE id = ?`).bind(id).first();
  if (!client) return errorJson("Cliente no encontrado.", 404);
  const { results: letters } = await env.DB.prepare(
    `SELECT l.*, t.name as template_name FROM letters l LEFT JOIN letter_templates t ON t.id = l.template_id WHERE l.client_id = ? ORDER BY l.created_at DESC`
  ).bind(id).all();
  const { results: activity } = await env.DB.prepare(
    `SELECT * FROM activity_log WHERE entity_type = 'client' AND entity_id = ? ORDER BY created_at DESC LIMIT 25`
  ).bind(id).all();
  return json({ client: sanitizeClient(client), letters: letters || [], activity: activity || [] });
}

// Genera (o regenera) el usuario/contraseña del portal de un cliente que todavía no lo tenía —
// clientes creados antes de esta versión. Es seguro correrlo más de una vez: a un cliente que ya
// tiene portal_username no se le toca nada.
async function clientPortalBackfill(env, user) {
  const { results } = await env.DB.prepare(`SELECT id, full_name FROM clients WHERE portal_username IS NULL OR portal_username = ''`).all();
  const created = [];
  for (const c of results || []) {
    const { username, password } = await assignPortalCredentials(env, c.id, c.full_name);
    await logActivity(env.DB, { entityType: "client", entityId: c.id, action: "portal_acceso_creado", detail: username, userId: user.uid });
    created.push({ client_id: c.id, client_name: c.full_name, portal_username: username, portal_password_plain: password });
  }
  return json({ created });
}

// El admin puede resetear la contraseña del portal de un cliente (ej. la olvidó) — el usuario se
// mantiene igual, solo cambia la contraseña. Se devuelve en texto plano una sola vez.
async function clientPortalResetPassword(env, user, id) {
  const client = await env.DB.prepare(`SELECT id, full_name, portal_username FROM clients WHERE id = ?`).bind(id).first();
  if (!client) return errorJson("Cliente no encontrado.", 404);
  const { username, password } = await assignPortalCredentials(env, id, client.full_name, client.portal_username);
  await logActivity(env.DB, { entityType: "client", entityId: id, action: "portal_password_regenerada", userId: user.uid });
  return json({ portal_username: username, portal_password_plain: password });
}

async function clientUpdate(request, env, user, id) {
  const existing = await env.DB.prepare(`SELECT * FROM clients WHERE id = ?`).bind(id).first();
  if (!existing) return errorJson("Cliente no encontrado.", 404);
  const body = await readJson(request);
  const fullName = (body.full_name || "").trim();
  if (!fullName) return errorJson("El nombre del cliente es requerido.");
  await env.DB.prepare(
    `UPDATE clients SET full_name=?, email=?, phone=?, address=?, city=?, state=?, zip=?, id_last4=?, date_of_birth=?, status=?, notes=?, updated_at=datetime('now') WHERE id = ?`
  )
    .bind(fullName, body.email || null, body.phone || null, body.address || null, body.city || null, body.state || null, body.zip || null, body.id_last4 || null, body.date_of_birth || null, body.status || "activo", body.notes || null, id)
    .run();
  await logActivity(env.DB, { entityType: "client", entityId: id, action: "cliente_actualizado", userId: user.uid });
  const client = await env.DB.prepare(`SELECT * FROM clients WHERE id = ?`).bind(id).first();
  return json({ client: sanitizeClient(client) });
}

async function clientDelete(env, user, id) {
  const existing = await env.DB.prepare(`SELECT * FROM clients WHERE id = ?`).bind(id).first();
  if (!existing) return errorJson("Cliente no encontrado.", 404);
  await env.DB.prepare(`DELETE FROM clients WHERE id = ?`).bind(id).run();
  await logActivity(env.DB, { entityType: "client", entityId: id, action: "cliente_eliminado", detail: existing.full_name, userId: user.uid });
  return json({ ok: true });
}

/* ================================ PLANTILLAS ================================ */

async function templatesList(env) {
  const { results } = await env.DB.prepare(`SELECT * FROM letter_templates ORDER BY category, name`).all();
  return json({ templates: results || [] });
}

async function templateCreate(request, env, user) {
  const body = await readJson(request);
  const name = (body.name || "").trim();
  const bodyText = (body.body || "").trim();
  if (!name) return errorJson("El nombre de la plantilla es requerido.");
  if (!bodyText) return errorJson("El contenido de la carta es requerido.");
  const result = await env.DB.prepare(
    `INSERT INTO letter_templates (name, category, recipient_hint, subject, body, is_active, include_id_copy, include_address_proof, include_ssn_copy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(name, body.category || "General", body.recipient_hint || null, body.subject || null, bodyText, body.is_active === false ? 0 : 1, body.include_id_copy ? 1 : 0, body.include_address_proof ? 1 : 0, body.include_ssn_copy ? 1 : 0)
    .run();
  const id = result.meta.last_row_id;
  await logActivity(env.DB, { entityType: "template", entityId: id, action: "plantilla_creada", detail: name, userId: user.uid });
  const template = await env.DB.prepare(`SELECT * FROM letter_templates WHERE id = ?`).bind(id).first();
  return json({ template });
}

async function templateGet(env, id) {
  const template = await env.DB.prepare(`SELECT * FROM letter_templates WHERE id = ?`).bind(id).first();
  if (!template) return errorJson("Plantilla no encontrada.", 404);
  return json({ template });
}

async function templateUpdate(request, env, user, id) {
  const existing = await env.DB.prepare(`SELECT * FROM letter_templates WHERE id = ?`).bind(id).first();
  if (!existing) return errorJson("Plantilla no encontrada.", 404);
  const body = await readJson(request);
  const name = (body.name || "").trim();
  const bodyText = (body.body || "").trim();
  if (!name) return errorJson("El nombre de la plantilla es requerido.");
  if (!bodyText) return errorJson("El contenido de la carta es requerido.");
  await env.DB.prepare(
    `UPDATE letter_templates SET name=?, category=?, recipient_hint=?, subject=?, body=?, is_active=?, include_id_copy=?, include_address_proof=?, include_ssn_copy=?, updated_at=datetime('now') WHERE id=?`
  )
    .bind(name, body.category || "General", body.recipient_hint || null, body.subject || null, bodyText, body.is_active === false ? 0 : 1, body.include_id_copy ? 1 : 0, body.include_address_proof ? 1 : 0, body.include_ssn_copy ? 1 : 0, id)
    .run();
  await logActivity(env.DB, { entityType: "template", entityId: id, action: "plantilla_actualizada", userId: user.uid });
  const template = await env.DB.prepare(`SELECT * FROM letter_templates WHERE id = ?`).bind(id).first();
  return json({ template });
}

async function templateDelete(env, user, id) {
  const existing = await env.DB.prepare(`SELECT * FROM letter_templates WHERE id = ?`).bind(id).first();
  if (!existing) return errorJson("Plantilla no encontrada.", 404);
  await env.DB.prepare(`DELETE FROM letter_templates WHERE id = ?`).bind(id).run();
  await logActivity(env.DB, { entityType: "template", entityId: id, action: "plantilla_eliminada", detail: existing.name, userId: user.uid });
  return json({ ok: true });
}

const TPL_CLIENT_HEADER = `{{cliente_nombre}}
{{cliente_direccion}}
{{cliente_ciudad_estado_zip}}

Social Security Number (last 4 digits): XXX-XX-{{cliente_id_last4}}

Date of birth: {{cliente_fecha_nacimiento}}


{{fecha}}
`;

const TPL_CLOSING = `
Sincerely,


{{cliente_nombre}}
Date: {{fecha}}

Enclosures: Copy of photo identification, proof of address

Sent via Certified Mail — Return Receipt Requested`;

const BUREAU_EQUIFAX = `Equifax Information Services LLC
P.O. Box 740256
Atlanta, GA 30374`;
const BUREAU_TRANSUNION = `TransUnion LLC Consumer Dispute Center
P.O. Box 2000
Chester, PA 19016`;
const BUREAU_EXPERIAN = `Experian
P.O. Box 4500
Allen, TX 75013`;

function round1Body(bureauBlock, bureauName) {
  return `${TPL_CLIENT_HEADER}
${bureauBlock}

RE: NOTICE OF DISPUTE AND DEMAND FOR FULL REINVESTIGATION — {{acreedor_nombre}}, ACCOUNT #{{numero_cuenta}}

To Whom It May Concern at ${bureauName}:

This letter constitutes formal, written notice under Section 611(a) of the Fair Credit Reporting Act (15 U.S.C. § 1681i) that I am disputing the accuracy, completeness, and reportability of the item(s) identified below. This is not a casual inquiry — it is a formal legal demand for a full, documented reinvestigation, not a routine automated "data-match."

Item(s) in dispute:
- Creditor/Furnisher: {{acreedor_nombre}}
- Account number: {{numero_cuenta}}
- Reason for dispute: {{motivo_disputa}}

You are required by law to complete a reasonable reinvestigation within thirty (30) days of receipt of this notice. In connection with that reinvestigation, I demand that you:

1. Forward all relevant information regarding this dispute to the furnisher and require the furnisher to conduct its own substantive investigation — not a computerized code confirming the account merely "exists."
2. Obtain and review actual account-level documentation supporting the accuracy of the reported balance, status, and dates — not a generic confirmation.
3. Provide me, in writing, with a description of the procedure used to determine accuracy, including the name, business address, and telephone number of every source contacted.
4. Delete this item immediately if it cannot be fully verified as accurate, complete, and up to date within the 30-day period, as required under Section 611(a)(5)(A) of the FCRA.
5. Send me a free, updated copy of my credit report upon completion of your investigation, pursuant to Section 612 of the FCRA.

If you fail to complete a full reinvestigation and provide the documentation described above within thirty (30) days of receipt of this notice, you must immediately delete this item from my credit file and notify me in writing that it has been deleted.

Be advised: reporting this item as "verified" without reviewing actual supporting documentation may constitute a violation of the FCRA and expose your agency to liability under 15 U.S.C. §§ 1681n and 1681o, including actual damages, statutory damages, punitive damages, and attorney's fees.

I have enclosed a copy of my photo identification and proof of address to verify my identity. All future correspondence regarding this dispute must be in writing to the address above.
${TPL_CLOSING}`;
}

function round2Body(bureauBlock, bureauName) {
  return `${TPL_CLIENT_HEADER}
${bureauBlock}

RE: DEMAND FOR METHOD OF VERIFICATION — {{acreedor_nombre}}, ACCOUNT #{{numero_cuenta}}

To Whom It May Concern at ${bureauName}:

On [FECHA DE LA RESPUESTA PREVIA], I received your response to my prior dispute (reference: [NÚMERO DE CONFIRMACIÓN/CASO]), in which you claimed the following item(s) were "verified" as accurate:

- Creditor/Collector: {{acreedor_nombre}}
- Account number: {{numero_cuenta}}

A one-word "verified" response, with no supporting detail, does not satisfy Section 611(a)(6) and (7) of the Fair Credit Reporting Act, which entitles me to know the specific method of verification used. This is not a request — it is a formal demand made pursuant to my rights under federal law. Within fifteen (15) days of receipt of this notice, you must provide me, in writing, with:

1. The full name, business address, and telephone number of the specific individual who performed the verification.
2. A detailed, itemized description of the verification method used, including exactly which original account-level documents were reviewed — not a simple automated electronic confirmation.
3. A copy of every document, record, or communication relied upon to verify this account.
4. Written confirmation that the furnisher was contacted directly and reviewed the original account records, as required by Cushman v. Trans Union Corp., 115 F.3d 220 (3d Cir. 1997).

If you cannot produce this specific documentation within fifteen (15) days, you must immediately and permanently delete this item from my credit file. "Verification" without supporting documentation does not satisfy the requirements of the law and constitutes a defective reinvestigation.

Failure to comply will be treated as further evidence of a pattern of noncompliance with the FCRA. I will not hesitate to file a formal complaint with the Consumer Financial Protection Bureau (CFPB), my state Attorney General, and the Federal Trade Commission (FTC), and to pursue all other remedies available to me under the law.
${TPL_CLOSING}`;
}

function round3Body(bureauBlock, bureauName) {
  return `${TPL_CLIENT_HEADER}
${bureauBlock}

RE: FINAL NOTICE BEFORE LEGAL ACTION — WILLFUL/NEGLIGENT FCRA NONCOMPLIANCE — ACCOUNT #{{numero_cuenta}}

To Whom It May Concern at ${bureauName}:

This is my THIRD and FINAL written communication regarding the disputed item(s) reported by {{acreedor_nombre}}, account number {{numero_cuenta}}. Despite my prior formal requests dated [FECHA DE LA CARTA 1] and [FECHA DE LA CARTA 2], your agency has failed to:

- Complete a reasonable investigation pursuant to Section 611(a) of the FCRA.
- Provide the specific method of verification demanded pursuant to Section 611(a)(7).
- Delete information that could not be verified within the 30-day legal deadline.

This pattern of conduct constitutes, at minimum, negligent noncompliance, and may constitute willful noncompliance with the Fair Credit Reporting Act, which carries civil liability pursuant to:

- 15 U.S.C. § 1681n (willful noncompliance): actual damages, statutory damages of $100–$1,000 per violation, punitive damages, and attorney's fees.
- 15 U.S.C. § 1681o (negligent noncompliance): actual damages and attorney's fees.

You have FIFTEEN (15) CALENDAR DAYS from the date of this letter to:

1. Permanently delete from my credit report the disputed item(s) that have not been properly verified; or
2. Provide me with complete, itemized, documentary proof of the verification performed, including the exact original records reviewed by the furnisher.

If I do not receive a satisfactory, documented resolution within this deadline, I will immediately proceed to:

3. File a formal complaint with the Consumer Financial Protection Bureau (CFPB).
4. File a complaint with the Attorney General of the State of [ESTADO] and the Federal Trade Commission (FTC).
5. Retain a consumer rights attorney to pursue a lawsuit for FCRA violations, including statutory and punitive damages.

This letter constitutes formal legal notice and will be entered into evidence should litigation become necessary. Govern yourselves accordingly.
${TPL_CLOSING}`;
}

const DEBT_VALIDATION_BODY = `${TPL_CLIENT_HEADER}
{{destinatario_nombre}}
{{destinatario_direccion}}

RE: NOTICE OF DISPUTE AND REQUEST FOR DEBT VALIDATION (Account #: {{numero_cuenta}})

To Whom It May Concern:

I am writing to formally dispute the validity of the above-referenced debt pursuant to the Fair Debt Collection Practices Act (FDCPA), 15 U.S.C. § 1692g. This is not a refusal to pay — it is a formal request for verification and proof that I have a legal obligation to pay your agency.

Your records indicate a balance of [MONTO DEL SALDO]. {{motivo_disputa}}. Under the FDCPA, I demand that you provide the following documentation to validate this claim:

1. A copy of the original contract or agreement bearing my signature that establishes a legal obligation to pay the original creditor.
2. A complete, itemized breakdown of the alleged debt, showing principal, interest, and any additional fees added by your agency.
3. Evidence of the chain of title, documenting every assignment or sale of this debt from the original creditor to {{destinatario_nombre}}.
4. Verification that your agency is legally licensed and registered to collect debts in my state of residence.
5. The date of the last activity on the original account and the date of default.

If you fail to provide the specific documentation requested above within thirty (30) days of receipt of this notice, you must immediately cease all collection efforts and remove any derogatory information regarding this account from all credit reporting agencies (Equifax, Experian, and TransUnion).

Furthermore, be advised that if this account is reported as "verified" to the credit bureaus without providing the requested documentation, I will file a formal complaint with the Consumer Financial Protection Bureau (CFPB) and the State Attorney General's office for violations of the FDCPA and the Fair Credit Reporting Act (FCRA).

I request that all future communications regarding this matter be conducted exclusively in writing via the address provided above.
${TPL_CLOSING}`;

const GOODWILL_BODY = `${TPL_CLIENT_HEADER}
{{destinatario_nombre}}
{{destinatario_direccion}}

RE: Account Number {{numero_cuenta}} — Goodwill Adjustment Request

Dear Sir or Madam:

I have held account number {{numero_cuenta}} since [FECHA DE APERTURA DE LA CUENTA]. I am writing to request, as a courtesy and goodwill gesture, the removal of the late payment(s) reported on [FECHA(S) DE PAGO TARDÍO].

I acknowledge that the payment was made after the due date. This occurred due to {{motivo_disputa}}, a situation that has since been resolved. As my history shows, I have maintained timely and responsible payment behavior on this account [ANTES Y/O DESPUÉS DE ESA FECHA].

Given my continued commitment as a customer and my payment history, I respectfully request that, as a gesture of goodwill, you consider removing this negative report from my credit history with Equifax, TransUnion, and Experian.

Thank you in advance for your consideration. I look forward to your response.

Sincerely,


{{cliente_nombre}}
Date: {{fecha}}

Enclosures: Copy of photo identification, proof of address

Sent via Certified Mail — Return Receipt Requested`;

const CEASE_DESIST_BODY = `${TPL_CLIENT_HEADER}
{{destinatario_nombre}}
{{destinatario_direccion}}

RE: Account Number {{numero_cuenta}} — Request to Cease Communication

Dear Sir or Madam:

Pursuant to Section 805(c) of the Fair Debt Collection Practices Act (15 U.S.C. § 1692c(c)), I am formally notifying you that I wish for you to cease all communication with me regarding the above account, whether by telephone, mail, email, text message, or any other means, except as specifically permitted by law, including:

1. Notifying me that your collection efforts have ceased.
2. Notifying me that you or the original creditor may invoke a specified remedy that you or the original creditor ordinarily invoke.
3. Notifying me that you or the original creditor intend to invoke such remedy.

Any further communication outside these exceptions will constitute a violation of the FDCPA, which may result in civil liability pursuant to 15 U.S.C. § 1692k.

Please also be advised that this letter does not constitute an acknowledgment that the referenced debt is valid, accurate, or that it belongs to me.
${TPL_CLOSING}`;

function inquiryDisputeBody(bureauBlock, bureauName) {
  return `${TPL_CLIENT_HEADER}
${bureauBlock}

RE: DISPUTE OF UNAUTHORIZED INQUIRY — {{acreedor_nombre}}

To Whom It May Concern at ${bureauName}:

I am writing to dispute an inquiry that appears on my credit report that I did not authorize. Pursuant to Section 604 of the Fair Credit Reporting Act (15 U.S.C. § 1681b), a consumer reporting agency may only furnish a consumer report to a party that has a legitimate, permissible purpose, and Section 611 (15 U.S.C. § 1681i) grants me the right to dispute inaccurate or unverifiable information in my file.

The following inquiry was made without my knowledge or authorization:

- Company: {{acreedor_nombre}}
- Date of inquiry: [FECHA DEL INQUIRY]

I did not apply for credit, request a credit check, or otherwise authorize {{acreedor_nombre}} to access my credit file on this date. An inquiry made without a permissible purpose is a violation of the FCRA.

I am formally requesting that you:

1. Investigate the circumstances under which this inquiry was made.
2. Provide me with the documentation {{acreedor_nombre}} used to establish a permissible purpose for accessing my credit file.
3. Remove this inquiry from my credit report immediately if a valid permissible purpose cannot be demonstrated within the time allowed by law.

Please complete your investigation within thirty (30) days pursuant to Section 611(a) of the FCRA, and send me written confirmation of the outcome. If this inquiry is not removed or validated, I will file a formal complaint with the Consumer Financial Protection Bureau (CFPB) and the Federal Trade Commission (FTC).
${TPL_CLOSING}`;
}

function personalInfoBody(bureauBlock, bureauName) {
  return `${TPL_CLIENT_HEADER}
${bureauBlock}

RE: DISPUTE AND REQUEST FOR CORRECTION OF PERSONAL IDENTIFYING INFORMATION

To Whom It May Concern at ${bureauName}:

This letter constitutes formal, written notice under Section 611(a) of the Fair Credit Reporting Act (15 U.S.C. § 1681i) that I am disputing inaccurate and outdated personal identifying information currently contained in my consumer file. This is a preliminary step in my credit dispute process, separate from the specific account disputes I am sending under separate cover.

My current, correct information is:

- Name: {{cliente_nombre}}
- Current address: {{cliente_direccion}}, {{cliente_ciudad_estado_zip}}
- Current phone number: [TELÉFONO ACTUAL DEL CLIENTE]

I am requesting that you delete from my file any of the following that do not match the current information listed above:

1. Any previous, former, or otherwise outdated mailing addresses.
2. Any name variations, misspellings, nicknames, or aliases that are not my legal name.
3. Any former or incorrect employers.
4. Any other outdated or inaccurate personal identifying information not listed above.

Please do NOT remove or alter my current address or current phone number listed above — that information is correct and must remain on file.

Multiple, conflicting, or outdated personal identifiers on a consumer file are a known source of mixed-file errors and can cause information belonging to other consumers to be merged into my file. I request that you conduct a full reinvestigation of this personal information pursuant to Section 611(a) of the FCRA and provide me with written confirmation of the outcome, along with an updated copy of my credit report, within thirty (30) days of receipt of this notice, pursuant to Section 612.

I have enclosed a copy of my photo identification and proof of my current address to verify my identity and confirm which address and information should remain on file.
${TPL_CLOSING}`;
}

const DIRECT_DISPUTE_FURNISHER_BODY = `${TPL_CLIENT_HEADER}
{{destinatario_nombre}}
{{destinatario_direccion}}

RE: DIRECT DISPUTE TO FURNISHER OF INFORMATION — {{acreedor_nombre}}, ACCOUNT #{{numero_cuenta}} (FCRA § 623(a)(8), 15 U.S.C. § 1681s-2(a)(8))

To Whom It May Concern:

This letter constitutes a formal DIRECT DISPUTE filed with you as the furnisher of information, pursuant to Section 623(a)(8) of the Fair Credit Reporting Act (15 U.S.C. § 1681s-2(a)(8)) and 12 C.F.R. § 1022.43. As a data furnisher, you are directly and independently obligated to investigate this dispute — this is not a request routed through a credit bureau, and it does not depend on any bureau's response.

Account in dispute:
- Creditor: {{acreedor_nombre}}
- Account number: {{numero_cuenta}}
- Reason for dispute: {{motivo_disputa}}

Pursuant to 15 U.S.C. § 1681s-2(b), upon receipt of this notice you are required to:

1. Conduct a reasonable investigation of the disputed information.
2. Review all relevant information I have provided, including the reason for this dispute stated above.
3. Report the results of your investigation to every consumer reporting agency to which you furnished this information.
4. If the information is found to be inaccurate, incomplete, or cannot be verified, promptly notify every consumer reporting agency to modify, delete, or permanently block the reporting of this item.
5. Going forward, report this account accurately and completely, or not at all.

You have thirty (30) days from receipt of this notice to complete your investigation. Continuing to furnish information you know or should know is inaccurate — or failing to conduct a reasonable investigation of this direct dispute — exposes you to liability under 15 U.S.C. § 1681s-2(b) and, where applicable, state unfair-practices statutes.

I have enclosed a copy of my photo identification and proof of address to verify my identity. All future correspondence regarding this account must be in writing to the address above.
${TPL_CLOSING}`;

const PAY_FOR_DELETE_BODY = `${TPL_CLIENT_HEADER}
{{destinatario_nombre}}
{{destinatario_direccion}}

RE: SETTLEMENT OFFER CONDITIONED ON DELETION — {{acreedor_nombre}}, ACCOUNT #{{numero_cuenta}}

To Whom It May Concern:

I am writing regarding the above-referenced account, currently reported with a balance of [MONTO DEL SALDO]. {{motivo_disputa}}

Without admitting liability or waiving any rights or defenses available to me under federal or state law, I am prepared to resolve this matter on the following condition:

In exchange for a mutually agreed payment toward this account, {{acreedor_nombre}} agrees, IN WRITING, prior to any payment being made, to permanently and completely DELETE all trade-line references to this account from every consumer reporting agency to which it has been furnished (Equifax, Experian, and TransUnion) — not merely update the status to "paid" or "settled."

This offer is made strictly on a "pay-for-delete" basis. If {{acreedor_nombre}} is unwilling to agree in writing to full deletion prior to payment, this offer is withdrawn and no payment will be made. I request your written response, on company letterhead, confirming acceptance of these terms within fifteen (15) days of receipt of this letter.

This letter is sent for settlement negotiation purposes and shall not be construed as an admission of the validity of this debt or a waiver of any rights, and shall not be admissible as evidence of liability in any proceeding.
${TPL_CLOSING}`;

const CREDITOR_FINAL_NOTICE_BODY = `${TPL_CLIENT_HEADER}
{{destinatario_nombre}}
{{destinatario_direccion}}

RE: FINAL NOTICE BEFORE LEGAL ACTION — FURNISHER VIOLATION OF FCRA § 623 — ACCOUNT #{{numero_cuenta}}

To Whom It May Concern:

This is my FINAL written communication regarding account number {{numero_cuenta}} before I pursue further legal remedies. Despite my prior direct dispute regarding this account dated [FECHA DE LA CARTA ANTERIOR], you have failed to:

- Conduct a reasonable investigation as required by 15 U.S.C. § 1681s-2(b).
- Correct, delete, or permanently block information that could not be verified as accurate.
- Report the results of your investigation to the consumer reporting agencies as required by law.

This continued conduct constitutes, at minimum, negligent noncompliance, and may constitute willful noncompliance with the Fair Credit Reporting Act as a furnisher of information, exposing you to liability under:

- 15 U.S.C. § 1681n (willful noncompliance): actual damages, statutory damages, punitive damages, and attorney's fees.
- 15 U.S.C. § 1681o (negligent noncompliance): actual damages and attorney's fees.

You have FIFTEEN (15) CALENDAR DAYS from the date of this letter to permanently delete or correct the inaccurate information reported on this account with all consumer reporting agencies, or provide me with complete, itemized, documentary proof that a reasonable investigation was conducted.

If I do not receive a satisfactory, documented resolution within this deadline, I will proceed to file formal complaints with the Consumer Financial Protection Bureau (CFPB) and the Federal Trade Commission (FTC), and to retain a consumer rights attorney to pursue litigation for FCRA violations, including statutory and punitive damages.

This letter constitutes formal legal notice and will be entered into evidence should litigation become necessary. Govern yourselves accordingly.
${TPL_CLOSING}`;

const SAMPLE_TEMPLATES = [
  { name: "Paso 0 — Limpieza de Información Personal (Equifax)", category: "Buró de Crédito — Información Personal", recipient_hint: "Equifax", subject: "Dispute and Request for Correction of Personal Identifying Information", body: personalInfoBody(BUREAU_EQUIFAX, "Equifax"), include_id_copy: 1, include_address_proof: 1 },
  { name: "Paso 0 — Limpieza de Información Personal (TransUnion)", category: "Buró de Crédito — Información Personal", recipient_hint: "TransUnion", subject: "Dispute and Request for Correction of Personal Identifying Information", body: personalInfoBody(BUREAU_TRANSUNION, "TransUnion"), include_id_copy: 1, include_address_proof: 1 },
  { name: "Paso 0 — Limpieza de Información Personal (Experian)", category: "Buró de Crédito — Información Personal", recipient_hint: "Experian", subject: "Dispute and Request for Correction of Personal Identifying Information", body: personalInfoBody(BUREAU_EXPERIAN, "Experian"), include_id_copy: 1, include_address_proof: 1 },
  { name: "Ronda 1 — Disputa Inicial (Equifax)", category: "Buró de Crédito — Ronda 1", recipient_hint: "Equifax", subject: "Notice of Dispute and Demand for Full Reinvestigation", body: round1Body(BUREAU_EQUIFAX, "Equifax"), include_id_copy: 1, include_address_proof: 1 },
  { name: "Ronda 1 — Disputa Inicial (TransUnion)", category: "Buró de Crédito — Ronda 1", recipient_hint: "TransUnion", subject: "Notice of Dispute and Demand for Full Reinvestigation", body: round1Body(BUREAU_TRANSUNION, "TransUnion"), include_id_copy: 1, include_address_proof: 1 },
  { name: "Ronda 1 — Disputa Inicial (Experian)", category: "Buró de Crédito — Ronda 1", recipient_hint: "Experian", subject: "Notice of Dispute and Demand for Full Reinvestigation", body: round1Body(BUREAU_EXPERIAN, "Experian"), include_id_copy: 1, include_address_proof: 1 },
  { name: "Ronda 2 — Método de Verificación / MOV (Equifax)", category: "Buró de Crédito — Ronda 2", recipient_hint: "Equifax", subject: "Demand for Method of Verification", body: round2Body(BUREAU_EQUIFAX, "Equifax"), include_id_copy: 1, include_address_proof: 1 },
  { name: "Ronda 2 — Método de Verificación / MOV (TransUnion)", category: "Buró de Crédito — Ronda 2", recipient_hint: "TransUnion", subject: "Demand for Method of Verification", body: round2Body(BUREAU_TRANSUNION, "TransUnion"), include_id_copy: 1, include_address_proof: 1 },
  { name: "Ronda 2 — Método de Verificación / MOV (Experian)", category: "Buró de Crédito — Ronda 2", recipient_hint: "Experian", subject: "Demand for Method of Verification", body: round2Body(BUREAU_EXPERIAN, "Experian"), include_id_copy: 1, include_address_proof: 1 },
  { name: "Ronda 3 — Aviso Final de Incumplimiento (Equifax)", category: "Buró de Crédito — Ronda 3", recipient_hint: "Equifax", subject: "Final Notice Before Legal Action", body: round3Body(BUREAU_EQUIFAX, "Equifax"), include_id_copy: 1, include_address_proof: 1 },
  { name: "Ronda 3 — Aviso Final de Incumplimiento (TransUnion)", category: "Buró de Crédito — Ronda 3", recipient_hint: "TransUnion", subject: "Final Notice Before Legal Action", body: round3Body(BUREAU_TRANSUNION, "TransUnion"), include_id_copy: 1, include_address_proof: 1 },
  { name: "Ronda 3 — Aviso Final de Incumplimiento (Experian)", category: "Buró de Crédito — Ronda 3", recipient_hint: "Experian", subject: "Final Notice Before Legal Action", body: round3Body(BUREAU_EXPERIAN, "Experian"), include_id_copy: 1, include_address_proof: 1 },
  { name: "Carta de Validación de Deuda (FDCPA § 1692g)", category: "Cobradores", recipient_hint: "Agencia de cobranza", subject: "Notice of Dispute and Request for Debt Validation", body: DEBT_VALIDATION_BODY, include_id_copy: 0, include_address_proof: 0 },
  { name: "Carta de Buena Voluntad (Goodwill)", category: "Acreedor", recipient_hint: "Acreedor original", subject: "Goodwill Adjustment Request", body: GOODWILL_BODY, include_id_copy: 0, include_address_proof: 0 },
  { name: "Carta de Cese de Comunicación (FDCPA § 1692c)", category: "Cobradores", recipient_hint: "Agencia de cobranza", subject: "Request to Cease Communication", body: CEASE_DESIST_BODY, include_id_copy: 0, include_address_proof: 0 },
  { name: "Disputa de Inquiry No Autorizado (Equifax)", category: "Buró de Crédito — Inquiries", recipient_hint: "Equifax", subject: "Dispute of Unauthorized Inquiry", body: inquiryDisputeBody(BUREAU_EQUIFAX, "Equifax"), include_id_copy: 1, include_address_proof: 1 },
  { name: "Disputa de Inquiry No Autorizado (TransUnion)", category: "Buró de Crédito — Inquiries", recipient_hint: "TransUnion", subject: "Dispute of Unauthorized Inquiry", body: inquiryDisputeBody(BUREAU_TRANSUNION, "TransUnion"), include_id_copy: 1, include_address_proof: 1 },
  { name: "Disputa de Inquiry No Autorizado (Experian)", category: "Buró de Crédito — Inquiries", recipient_hint: "Experian", subject: "Dispute of Unauthorized Inquiry", body: inquiryDisputeBody(BUREAU_EXPERIAN, "Experian"), include_id_copy: 1, include_address_proof: 1 },
  { name: "Acreedor Original — Disputa Directa al Furnisher (FCRA § 623)", category: "Acreedor Original — Disputa Directa", recipient_hint: "Acreedor original", subject: "Direct Dispute to Furnisher of Information", body: DIRECT_DISPUTE_FURNISHER_BODY, include_id_copy: 1, include_address_proof: 1 },
  { name: "Acreedor Original — Oferta Pay for Delete", category: "Acreedor Original — Negociación", recipient_hint: "Acreedor original", subject: "Settlement Offer Conditioned on Deletion", body: PAY_FOR_DELETE_BODY, include_id_copy: 0, include_address_proof: 0 },
  { name: "Acreedor Original — Aviso Final / Intento de Demanda", category: "Acreedor Original — Aviso Final", recipient_hint: "Acreedor original", subject: "Final Notice Before Legal Action — Furnisher Violation", body: CREDITOR_FINAL_NOTICE_BODY, include_id_copy: 0, include_address_proof: 0 },
];

async function templatesSeed(env, user) {
  const { results: existing } = await env.DB.prepare(`SELECT name FROM letter_templates`).all();
  const existingNames = new Set((existing || []).map((r) => r.name));
  let inserted = 0;
  for (const t of SAMPLE_TEMPLATES) {
    if (existingNames.has(t.name)) continue;
    await env.DB.prepare(`INSERT INTO letter_templates (name, category, recipient_hint, subject, body, is_active, include_id_copy, include_address_proof) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
      .bind(t.name, t.category, t.recipient_hint, t.subject, t.body, t.include_id_copy ? 1 : 0, t.include_address_proof ? 1 : 0)
      .run();
    inserted++;
  }
  if (inserted > 0) {
    await logActivity(env.DB, { entityType: "template", entityId: 0, action: "plantillas_ejemplo_cargadas", detail: `${inserted} plantillas`, userId: user.uid });
  }
  return json({ ok: true, inserted });
}

/* ================================ IMPORTAR PLANTILLA (PDF / DOCX) ================================ */
/* Extractores de texto sin dependencias externas (necesario para que el backend siga siendo
   un solo _worker.js compatible con "arrastrar y soltar" en Cloudflare Pages). */

function u8ToBinaryString(bytes) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return s;
}

async function inflateBytes(bytes, raw) {
  const ds = new DecompressionStream(raw ? "deflate-raw" : "deflate");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

/* ---------- DOCX (.docx es un ZIP con word/document.xml) ---------- */

function zipReadUInt32LE(bytes, off) {
  return bytes[off] | (bytes[off + 1] << 8) | (bytes[off + 2] << 16) | (bytes[off + 3] * 0x1000000);
}
function zipReadUInt16LE(bytes, off) {
  return bytes[off] | (bytes[off + 1] << 8);
}

async function unzipEntry(bytes, entryName) {
  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  const maxBack = Math.min(bytes.length, 65557);
  for (let i = bytes.length - 22; i >= bytes.length - maxBack && i >= 0; i--) {
    if (zipReadUInt32LE(bytes, i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Archivo .docx inválido (no se encontró el índice central del ZIP).");

  const cdEntries = zipReadUInt16LE(bytes, eocdOffset + 10);
  const cdOffset = zipReadUInt32LE(bytes, eocdOffset + 16);

  let p = cdOffset;
  const CFH_SIG = 0x02014b50;
  for (let i = 0; i < cdEntries; i++) {
    if (zipReadUInt32LE(bytes, p) !== CFH_SIG) break;
    const compMethod = zipReadUInt16LE(bytes, p + 10);
    const compSize = zipReadUInt32LE(bytes, p + 20);
    const nameLen = zipReadUInt16LE(bytes, p + 28);
    const extraLen = zipReadUInt16LE(bytes, p + 30);
    const commentLen = zipReadUInt16LE(bytes, p + 32);
    const localHeaderOffset = zipReadUInt32LE(bytes, p + 42);
    const name = u8ToBinaryString(bytes.subarray(p + 46, p + 46 + nameLen));

    if (name === entryName) {
      const LFH_SIG = 0x04034b50;
      if (zipReadUInt32LE(bytes, localHeaderOffset) !== LFH_SIG) throw new Error("Encabezado ZIP local inválido.");
      const lNameLen = zipReadUInt16LE(bytes, localHeaderOffset + 26);
      const lExtraLen = zipReadUInt16LE(bytes, localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
      const raw = bytes.subarray(dataStart, dataStart + compSize);
      if (compMethod === 0) return raw;
      if (compMethod === 8) return await inflateBytes(raw, true);
      throw new Error(`Método de compresión ZIP no soportado (${compMethod}).`);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error(`No se encontró "${entryName}" dentro del archivo .docx.`);
}

async function extractDocxText(bytes) {
  const xmlBytes = await unzipEntry(bytes, "word/document.xml");
  const xml = new TextDecoder("utf-8").decode(xmlBytes);
  const bodyMatch = xml.match(/<w:body[^>]*>([\s\S]*?)<\/w:body>/);
  const body = bodyMatch ? bodyMatch[1] : xml;

  let out = "";
  const tokenRe = /<w:t[^>]*>([\s\S]*?)<\/w:t>|<w:tab\/?>|<w:br\/?>|<w:cr\/?>|<w:p\b[^>]*\/>|<\/w:p>/g;
  let m;
  while ((m = tokenRe.exec(body))) {
    const whole = m[0];
    if (whole.startsWith("<w:t")) out += decodeXmlEntities(m[1] || "");
    else if (whole.startsWith("<w:tab")) out += "\t";
    else if (whole.startsWith("<w:br") || whole.startsWith("<w:cr")) out += "\n";
    else if (whole === "</w:p>" || (whole.startsWith("<w:p") && whole.endsWith("/>"))) out += "\n";
  }

  return out
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/* ---------- PDF (best-effort; solo PDFs de texto, no escaneados) ---------- */

function pdfFindObjects(pdfStr) {
  const map = new Map();
  const re = /(\d+)[ \t]+(\d+)[ \t]+obj\b/g;
  let m;
  while ((m = re.exec(pdfStr))) {
    const num = parseInt(m[1], 10);
    if (!map.has(num)) map.set(num, m.index);
  }
  return map;
}

function pdfParseDictAt(pdfStr, startIdx) {
  const openIdx = pdfStr.indexOf("<<", startIdx);
  if (openIdx === -1) return { dict: "", end: startIdx };
  let depth = 0;
  let i = openIdx;
  while (i < pdfStr.length) {
    if (pdfStr[i] === "<" && pdfStr[i + 1] === "<") { depth++; i += 2; continue; }
    if (pdfStr[i] === ">" && pdfStr[i + 1] === ">") { depth--; i += 2; if (depth === 0) break; continue; }
    i++;
  }
  return { dict: pdfStr.slice(openIdx, i), end: i };
}

function pdfGetRefs(dict, key) {
  const single = dict.match(new RegExp(`/${key}\\s+(\\d+)\\s+\\d+\\s+R`));
  if (single) return [parseInt(single[1], 10)];
  const arrMatch = dict.match(new RegExp(`/${key}\\s*\\[([^\\]]*)\\]`));
  if (arrMatch) {
    const nums = [];
    const re = /(\d+)\s+\d+\s+R/g;
    let m;
    while ((m = re.exec(arrMatch[1]))) nums.push(parseInt(m[1], 10));
    return nums;
  }
  return [];
}

/* ---------- PDF: soporte para PDFs con contraseña vacía (Standard Security Handler) ----------
   Muchos reportes de crédito (incluido el de muestra real que se usó para construir esto) se
   generan con el PDF "protegido" pero sin pedir contraseña al abrirlo (contraseña de usuario
   vacía) — el contenido de cada stream está cifrado con RC4 o AES-128 (CFM AESV2). Esto
   implementa el Algoritmo 2 (clave de archivo) y el Algoritmo 1 (clave por objeto) del estándar
   PDF, sin dependencias externas (MD5 propio + Web Crypto para AES-CBC). */

function md5Binary(inputBinaryStr) {
  function cmn(q, a, b, x, s, t) {
    a = add32(add32(a, q), add32(x, t));
    return add32((a << s) | (a >>> (32 - s)), b);
  }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
  function add32(a, b) { return (a + b) & 0xffffffff; }
  function md5blk(s) {
    const blks = [];
    for (let i = 0; i < 64; i += 4) blks[i >> 2] = s.charCodeAt(i) + (s.charCodeAt(i + 1) << 8) + (s.charCodeAt(i + 2) << 16) + (s.charCodeAt(i + 3) << 24);
    return blks;
  }
  function md5cycle(x, k) {
    let a = x[0], b = x[1], c = x[2], d = x[3];
    a = ff(a, b, c, d, k[0], 7, -680876936); d = ff(d, a, b, c, k[1], 12, -389564586); c = ff(c, d, a, b, k[2], 17, 606105819); b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897); d = ff(d, a, b, c, k[5], 12, 1200080426); c = ff(c, d, a, b, k[6], 17, -1473231341); b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416); d = ff(d, a, b, c, k[9], 12, -1958414417); c = ff(c, d, a, b, k[10], 17, -42063); b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682); d = ff(d, a, b, c, k[13], 12, -40341101); c = ff(c, d, a, b, k[14], 17, -1502002290); b = ff(b, c, d, a, k[15], 22, 1236535329);
    a = gg(a, b, c, d, k[1], 5, -165796510); d = gg(d, a, b, c, k[6], 9, -1069501632); c = gg(c, d, a, b, k[11], 14, 643717713); b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691); d = gg(d, a, b, c, k[10], 9, 38016083); c = gg(c, d, a, b, k[15], 14, -660478335); b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438); d = gg(d, a, b, c, k[14], 9, -1019803690); c = gg(c, d, a, b, k[3], 14, -187363961); b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467); d = gg(d, a, b, c, k[2], 9, -51403784); c = gg(c, d, a, b, k[7], 14, 1735328473); b = gg(b, c, d, a, k[12], 20, -1926607734);
    a = hh(a, b, c, d, k[5], 4, -378558); d = hh(d, a, b, c, k[8], 11, -2022574463); c = hh(c, d, a, b, k[11], 16, 1839030562); b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060); d = hh(d, a, b, c, k[4], 11, 1272893353); c = hh(c, d, a, b, k[7], 16, -155497632); b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174); d = hh(d, a, b, c, k[0], 11, -358537222); c = hh(c, d, a, b, k[3], 16, -722521979); b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487); d = hh(d, a, b, c, k[12], 11, -421815835); c = hh(c, d, a, b, k[15], 16, 530742520); b = hh(b, c, d, a, k[2], 23, -995338651);
    a = ii(a, b, c, d, k[0], 6, -198630844); d = ii(d, a, b, c, k[7], 10, 1126891415); c = ii(c, d, a, b, k[14], 15, -1416354905); b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571); d = ii(d, a, b, c, k[3], 10, -1894986606); c = ii(c, d, a, b, k[10], 15, -1051523); b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359); d = ii(d, a, b, c, k[15], 10, -30611744); c = ii(c, d, a, b, k[6], 15, -1560198380); b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070); d = ii(d, a, b, c, k[11], 10, -1120210379); c = ii(c, d, a, b, k[2], 15, 718787259); b = ii(b, c, d, a, k[9], 21, -343485551);
    x[0] = add32(a, x[0]); x[1] = add32(b, x[1]); x[2] = add32(c, x[2]); x[3] = add32(d, x[3]);
  }
  function rhex(n) {
    let s = "";
    for (let j = 0; j < 4; j++) s += String.fromCharCode((n >> (j * 8)) & 0xff);
    return s;
  }
  const s0 = inputBinaryStr;
  const n = s0.length;
  const state = [1732584193, -271733879, -1732584194, 271733878];
  let i;
  for (i = 64; i <= n; i += 64) md5cycle(state, md5blk(s0.substring(i - 64, i)));
  let tailStr = s0.substring(i - 64);
  const tail = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let j;
  for (j = 0; j < tailStr.length; j++) tail[j >> 2] |= tailStr.charCodeAt(j) << ((j % 4) << 3);
  tail[j >> 2] |= 0x80 << ((j % 4) << 3);
  if (j > 55) {
    md5cycle(state, tail);
    for (j = 0; j < 16; j++) tail[j] = 0;
  }
  tail[14] = n * 8;
  md5cycle(state, tail);
  let out = "";
  for (i = 0; i < 4; i++) out += rhex(state[i]);
  return out;
}

function rc4Bytes(keyBin, dataBytes) {
  const S = new Uint8Array(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  const keyLen = keyBin.length || 1;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + keyBin.charCodeAt(i % keyLen)) & 0xff;
    const t = S[i]; S[i] = S[j]; S[j] = t;
  }
  const out = new Uint8Array(dataBytes.length);
  let i = 0; j = 0;
  for (let k = 0; k < dataBytes.length; k++) {
    i = (i + 1) & 0xff;
    j = (j + S[i]) & 0xff;
    const t = S[i]; S[i] = S[j]; S[j] = t;
    out[k] = dataBytes[k] ^ S[(S[i] + S[j]) & 0xff];
  }
  return out;
}

const PDF_PASSWORD_PAD = [
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
].map((b) => String.fromCharCode(b)).join("");

function pdfLe32(n) {
  const u = n >>> 0;
  return String.fromCharCode(u & 0xff, (u >> 8) & 0xff, (u >> 16) & 0xff, (u >> 24) & 0xff);
}

function pdfGetLiteralStringField(dict, key) {
  const idx = dict.indexOf(`/${key}(`);
  if (idx === -1) return null;
  let i = idx + key.length + 2;
  let depth = 1;
  const start = i;
  while (i < dict.length && depth > 0) {
    if (dict[i] === "\\") { i += 2; continue; }
    if (dict[i] === "(") depth++;
    else if (dict[i] === ")") { depth--; if (depth === 0) break; }
    i++;
  }
  return pdfDecodeLiteralString(dict.slice(start, i));
}

function pdfGetIntField(dict, key) {
  const m = dict.match(new RegExp(`/${key}\\s+(-?\\d+)`));
  return m ? parseInt(m[1], 10) : null;
}

function pdfComputeFileKey({ oBin, p, idBin, keyLenBytes, revision, encryptMetadata }) {
  let input = (PDF_PASSWORD_PAD) + oBin.slice(0, 32) + pdfLe32(p) + idBin;
  if (revision >= 4 && encryptMetadata === false) input += String.fromCharCode(0xff, 0xff, 0xff, 0xff);
  let digest = md5Binary(input);
  if (revision >= 3) {
    for (let i = 0; i < 50; i++) digest = md5Binary(digest.slice(0, keyLenBytes));
  }
  return digest.slice(0, keyLenBytes);
}

function pdfComputeObjectKey(fileKey, objNum, genNum, isAES) {
  let input = fileKey + String.fromCharCode(objNum & 0xff, (objNum >> 8) & 0xff, (objNum >> 16) & 0xff, genNum & 0xff, (genNum >> 8) & 0xff);
  if (isAES) input += String.fromCharCode(0x73, 0x41, 0x6c, 0x54); // "sAlT"
  const digest = md5Binary(input);
  return digest.slice(0, Math.min(fileKey.length + 5, 16));
}

function pdfBinToBytes(bin) {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 0xff;
  return out;
}

async function pdfAesCbcDecrypt(objKeyBin, dataBytes) {
  if (dataBytes.length <= 16) return new Uint8Array(0);
  const key = await crypto.subtle.importKey("raw", pdfBinToBytes(objKeyBin), { name: "AES-CBC" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-CBC", iv: dataBytes.slice(0, 16) }, key, dataBytes.slice(16));
  return new Uint8Array(plain);
}

function pdfBuildDecryptContext(pdfStr, objects) {
  const trailerIdx = pdfStr.lastIndexOf("trailer");
  if (trailerIdx === -1) return null;
  const { dict: tdict } = pdfParseDictAt(pdfStr, trailerIdx);
  const encRefs = pdfGetRefs(tdict, "Encrypt");
  if (!encRefs.length) return null;
  const encOffset = objects.get(encRefs[0]);
  if (encOffset === undefined) return null;
  const { dict: encDict } = pdfParseDictAt(pdfStr, encOffset);

  const filter = (encDict.match(/\/Filter\s*\/(\w+)/) || [])[1];
  if (filter !== "Standard") return null; // manejador de seguridad no estándar, no soportado

  const oBin = pdfGetLiteralStringField(encDict, "O");
  const p = pdfGetIntField(encDict, "P");
  const revision = pdfGetIntField(encDict, "R") || 2;
  if (!oBin || p === null) return null;

  const idMatch = tdict.match(/\/ID\s*\[\s*<([0-9A-Fa-f]+)>/);
  let idBin = "";
  if (idMatch) {
    const idHex = idMatch[1];
    for (let i = 0; i + 2 <= idHex.length; i += 2) idBin += String.fromCharCode(parseInt(idHex.slice(i, i + 2), 16));
  }

  let cfDict = "";
  const cfIdx = encDict.indexOf("/CF<<");
  if (cfIdx !== -1) {
    let i = cfIdx + 3, depth = 0, start = i;
    while (i < encDict.length) {
      if (encDict[i] === "<" && encDict[i + 1] === "<") { depth++; i += 2; continue; }
      if (encDict[i] === ">" && encDict[i + 1] === ">") { depth--; i += 2; if (depth === 0) break; continue; }
      i++;
    }
    cfDict = encDict.slice(start, i);
  }
  const cfLenMatch = cfDict.match(/\/Length\s+(\d+)/);
  const cfLengthBytes = cfLenMatch ? parseInt(cfLenMatch[1], 10) : null;
  const topLengthBits = pdfGetIntField(cfDict ? encDict.replace(cfDict, "") : encDict, "Length");
  const keyLenBytes = cfLengthBytes || (topLengthBits ? topLengthBits / 8 : 5);
  const isAES = /AESV/.test(cfDict) || /AESV/.test(encDict);
  if (isAES && /AESV3/.test(cfDict)) return null; // AES-256 (V5/R6) no soportado aún
  const encryptMetadataMatch = encDict.match(/\/EncryptMetadata\s+(true|false)/);
  const encryptMetadata = encryptMetadataMatch ? encryptMetadataMatch[1] === "true" : true;

  let fileKey;
  try {
    fileKey = pdfComputeFileKey({ oBin, p, idBin, keyLenBytes, revision, encryptMetadata });
  } catch (e) {
    return null;
  }
  return { fileKey, isAES };
}

async function pdfDecryptStreamBytes(ctx, objNum, genNum, dataBytes) {
  const objKey = pdfComputeObjectKey(ctx.fileKey, objNum, genNum, ctx.isAES);
  if (ctx.isAES) return await pdfAesCbcDecrypt(objKey, dataBytes);
  return rc4Bytes(objKey, dataBytes);
}

async function pdfGetObjectDictAndStream(pdfStr, objects, objNum, bytes, decryptCtx) {
  const offset = objects.get(objNum);
  if (offset === undefined) return null;
  const { dict, end } = pdfParseDictAt(pdfStr, offset);
  const endobjIdx = pdfStr.indexOf("endobj", offset);
  const streamKwIdx = pdfStr.indexOf("stream", end);
  if (streamKwIdx === -1 || (endobjIdx !== -1 && streamKwIdx > endobjIdx)) return { dict, raw: null };
  let dataStart = streamKwIdx + "stream".length;
  if (pdfStr[dataStart] === "\r") dataStart++;
  if (pdfStr[dataStart] === "\n") dataStart++;
  let dataEnd = pdfStr.indexOf("endstream", dataStart);
  if (dataEnd === -1) return { dict, raw: null };
  if (bytes[dataEnd - 1] === 0x0a) dataEnd--;
  if (bytes[dataEnd - 1] === 0x0d) dataEnd--;
  let raw = bytes.subarray(dataStart, dataEnd);
  if (decryptCtx && !/\/Type\s*\/XRef\b/.test(dict)) {
    try {
      raw = await pdfDecryptStreamBytes(decryptCtx, objNum, 0, raw);
    } catch (e) {
      return { dict, raw: null, error: "decrypt: " + e.message };
    }
  }
  const isFlate = /\/Filter\s*(\/FlateDecode|\[[^\]]*\/FlateDecode[^\]]*\])/.test(dict);
  if (isFlate) {
    try {
      raw = await inflateBytes(raw, false);
    } catch (e) {
      return { dict, raw: null, error: e.message };
    }
  }
  return { dict, raw };
}

function pdfHexToUnicode(hex) {
  let out = "";
  for (let i = 0; i < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
  return out;
}

function pdfParseCMap(cmapText) {
  const map = new Map();
  let codeByteLen = 2;
  const csMatch = cmapText.match(/begincodespacerange([\s\S]*?)endcodespacerange/);
  if (csMatch) {
    const hex = csMatch[1].match(/<([0-9a-fA-F]+)>/);
    if (hex) codeByteLen = hex[1].length / 2;
  }
  const charBlockRe = /beginbfchar([\s\S]*?)endbfchar/g;
  let cb;
  while ((cb = charBlockRe.exec(cmapText))) {
    const pairRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let pm;
    while ((pm = pairRe.exec(cb[1]))) map.set(parseInt(pm[1], 16), pdfHexToUnicode(pm[2]));
  }
  const rangeBlockRe = /beginbfrange([\s\S]*?)endbfrange/g;
  let rb;
  while ((rb = rangeBlockRe.exec(cmapText))) {
    const body = rb[1];
    const rangeRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let rm;
    while ((rm = rangeRe.exec(body))) {
      const lo = parseInt(rm[1], 16);
      const hi = parseInt(rm[2], 16);
      const dstStart = parseInt(rm[3], 16);
      for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, String.fromCodePoint(dstStart + (c - lo)));
    }
    const arrRe = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*\[([^\]]*)\]/g;
    let am;
    while ((am = arrRe.exec(body))) {
      const lo = parseInt(am[1], 16);
      const items = [...am[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => x[1]);
      items.forEach((hex, i) => map.set(lo + i, pdfHexToUnicode(hex)));
    }
  }
  return { map, codeByteLen };
}

function pdfDecodeLiteralString(inner) {
  let out = "";
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "\\") {
      const n = inner[i + 1];
      if (n === "n") { out += "\n"; i++; }
      else if (n === "r") { out += "\r"; i++; }
      else if (n === "t") { out += "\t"; i++; }
      else if (n === "b" || n === "f") { i++; }
      else if (n === "(" || n === ")" || n === "\\") { out += n; i++; }
      else if (/[0-7]/.test(n)) {
        let oct = n; i++;
        for (let k = 0; k < 2 && /[0-7]/.test(inner[i + 1]); k++) { oct += inner[i + 1]; i++; }
        out += String.fromCharCode(parseInt(oct, 8) & 0xff);
      } else if (n === "\n" || n === "\r") { i++; }
      else { out += n; i++; }
    } else out += c;
  }
  return out;
}

function pdfDecodeWithFont(codeStr, isHex, font) {
  if (!font || !font.map || font.map.size === 0) return isHex ? pdfHexToLatin1(codeStr) : codeStr;
  const len = font.codeByteLen || 1;
  let out = "";
  if (isHex) {
    const clean = codeStr.replace(/\s+/g, "");
    for (let i = 0; i + len * 2 <= clean.length; i += len * 2) {
      const code = parseInt(clean.slice(i, i + len * 2), 16);
      out += font.map.has(code) ? font.map.get(code) : "";
    }
  } else {
    for (let i = 0; i < codeStr.length; i++) {
      const code = codeStr.charCodeAt(i);
      out += font.map.has(code) ? font.map.get(code) : codeStr[i];
    }
  }
  return out;
}

function pdfHexToLatin1(hex) {
  const clean = hex.replace(/\s+/g, "");
  let out = "";
  for (let i = 0; i + 2 <= clean.length; i += 2) out += String.fromCharCode(parseInt(clean.slice(i, i + 2), 16));
  return out;
}

function pdfExtractTextFromContentStream(streamStr, fontMap) {
  let out = "";
  let i = 0;
  const len = streamStr.length;
  let currentFont = null;

  while (i < len) {
    const c = streamStr[i];

    if (c === "/") {
      const m = /\/([A-Za-z0-9#+._-]+)\s+([\d.]+)\s+Tf/.exec(streamStr.slice(i, i + 60));
      if (m && streamStr.slice(i, i + m[0].length) === m[0]) {
        currentFont = fontMap.get(m[1]) || null;
        i += m[0].length;
        continue;
      }
      i++;
      continue;
    }

    if (c === "(") {
      let depth = 1, j = i + 1, buf = "";
      while (j < len && depth > 0) {
        const cj = streamStr[j];
        if (cj === "\\") { buf += cj + (streamStr[j + 1] || ""); j += 2; continue; }
        if (cj === "(") depth++;
        if (cj === ")") { depth--; if (depth === 0) break; }
        buf += cj; j++;
      }
      out += pdfDecodeWithFont(pdfDecodeLiteralString(buf), false, currentFont);
      i = j + 1;
      continue;
    }

    if (c === "<") {
      if (streamStr[i + 1] === "<") {
        let depth = 1, j = i + 2;
        while (j < len && depth > 0) {
          if (streamStr[j] === "<" && streamStr[j + 1] === "<") { depth++; j += 2; continue; }
          if (streamStr[j] === ">" && streamStr[j + 1] === ">") { depth--; j += 2; continue; }
          j++;
        }
        i = j;
        continue;
      }
      const closeIdx = streamStr.indexOf(">", i + 1);
      if (closeIdx === -1) { i++; continue; }
      out += pdfDecodeWithFont(streamStr.slice(i + 1, closeIdx), true, currentFont);
      i = closeIdx + 1;
      continue;
    }

    if (c === "[") {
      let j = i + 1, arrBuf = "";
      while (j < len && streamStr[j] !== "]") { arrBuf += streamStr[j]; j++; }
      let k = 0;
      while (k < arrBuf.length) {
        if (arrBuf[k] === "(") {
          let depth = 1, jj = k + 1, buf = "";
          while (jj < arrBuf.length && depth > 0) {
            const cj = arrBuf[jj];
            if (cj === "\\") { buf += cj + (arrBuf[jj + 1] || ""); jj += 2; continue; }
            if (cj === "(") depth++;
            if (cj === ")") { depth--; if (depth === 0) break; }
            buf += cj; jj++;
          }
          out += pdfDecodeWithFont(pdfDecodeLiteralString(buf), false, currentFont);
          k = jj + 1;
        } else if (arrBuf[k] === "<") {
          const close = arrBuf.indexOf(">", k + 1);
          if (close === -1) break;
          out += pdfDecodeWithFont(arrBuf.slice(k + 1, close), true, currentFont);
          k = close + 1;
        } else k++;
      }
      i = j + 1;
      continue;
    }

    if (streamStr.startsWith("Td", i) || streamStr.startsWith("TD", i) || streamStr.startsWith("T*", i)) {
      out += "\n";
      i += 2;
      continue;
    }

    i++;
  }
  return out;
}

/* ---------- PDF: extracción con posición (x,y) por cada fragmento de texto ----------
   Se usa solo para el lector de reportes de crédito: muchos reportes dibujan cada celda de
   una tabla con su propia posición absoluta (operador Tm) y sin espacios entre celdas, así que
   el texto plano de pdfExtractTextFromContentStream queda todo pegado. Conservar la posición de
   cada fragmento permite reconstruir filas/columnas por coordenadas en vez de por espacios. */
function pdfExtractPositionedRuns(streamStr, fontMap) {
  const runs = [];
  let i = 0;
  const len = streamStr.length;
  let currentFont = null;
  let curX = null, curY = null;

  function pushText(text) {
    if (!text) return;
    const last = runs[runs.length - 1];
    if (last && last.x === curX && last.y === curY) last.text += text;
    else runs.push({ text, x: curX, y: curY });
  }

  while (i < len) {
    const c = streamStr[i];

    if (c === "/") {
      const m = /\/([A-Za-z0-9#+._-]+)\s+([\d.]+)\s+Tf/.exec(streamStr.slice(i, i + 60));
      if (m && streamStr.slice(i, i + m[0].length) === m[0]) {
        currentFont = fontMap.get(m[1]) || null;
        i += m[0].length;
        continue;
      }
      i++;
      continue;
    }

    if ((c >= "0" && c <= "9") || c === "-" || c === ".") {
      const mTm = /^(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm/.exec(streamStr.slice(i, i + 90));
      if (mTm) {
        curX = parseFloat(mTm[5]);
        curY = parseFloat(mTm[6]);
        i += mTm[0].length;
        continue;
      }
      const mTd = /^(-?[\d.]+)\s+(-?[\d.]+)\s+T[dD]\b/.exec(streamStr.slice(i, i + 40));
      if (mTd) {
        const tx = parseFloat(mTd[1]), ty = parseFloat(mTd[2]);
        if (curX === null) { curX = tx; curY = ty; }
        else { curX += tx; curY += ty; }
        i += mTd[0].length;
        continue;
      }
      i++;
      continue;
    }

    if (c === "(") {
      let depth = 1, j = i + 1, buf = "";
      while (j < len && depth > 0) {
        const cj = streamStr[j];
        if (cj === "\\") { buf += cj + (streamStr[j + 1] || ""); j += 2; continue; }
        if (cj === "(") depth++;
        if (cj === ")") { depth--; if (depth === 0) break; }
        buf += cj; j++;
      }
      pushText(pdfDecodeWithFont(pdfDecodeLiteralString(buf), false, currentFont));
      i = j + 1;
      continue;
    }

    if (c === "<") {
      if (streamStr[i + 1] === "<") {
        let depth = 1, j = i + 2;
        while (j < len && depth > 0) {
          if (streamStr[j] === "<" && streamStr[j + 1] === "<") { depth++; j += 2; continue; }
          if (streamStr[j] === ">" && streamStr[j + 1] === ">") { depth--; j += 2; continue; }
          j++;
        }
        i = j;
        continue;
      }
      const closeIdx = streamStr.indexOf(">", i + 1);
      if (closeIdx === -1) { i++; continue; }
      pushText(pdfDecodeWithFont(streamStr.slice(i + 1, closeIdx), true, currentFont));
      i = closeIdx + 1;
      continue;
    }

    if (c === "[") {
      let j = i + 1, arrBuf = "";
      while (j < len && streamStr[j] !== "]") { arrBuf += streamStr[j]; j++; }
      let k = 0;
      while (k < arrBuf.length) {
        if (arrBuf[k] === "(") {
          let depth = 1, jj = k + 1, buf = "";
          while (jj < arrBuf.length && depth > 0) {
            const cj = arrBuf[jj];
            if (cj === "\\") { buf += cj + (arrBuf[jj + 1] || ""); jj += 2; continue; }
            if (cj === "(") depth++;
            if (cj === ")") { depth--; if (depth === 0) break; }
            buf += cj; jj++;
          }
          pushText(pdfDecodeWithFont(pdfDecodeLiteralString(buf), false, currentFont));
          k = jj + 1;
        } else if (arrBuf[k] === "<") {
          const close = arrBuf.indexOf(">", k + 1);
          if (close === -1) break;
          pushText(pdfDecodeWithFont(arrBuf.slice(k + 1, close), true, currentFont));
          k = close + 1;
        } else k++;
      }
      i = j + 1;
      continue;
    }

    i++;
  }
  return runs;
}

async function extractPdfText(bytes) {
  const pdfStr = u8ToBinaryString(bytes);
  const objects = pdfFindObjects(pdfStr);
  if (objects.size === 0) throw new Error("No se reconoce como un PDF válido.");
  const decryptCtx = pdfBuildDecryptContext(pdfStr, objects);

  let rootNum = null;
  const trailerIdx = pdfStr.lastIndexOf("trailer");
  if (trailerIdx !== -1) {
    const { dict } = pdfParseDictAt(pdfStr, trailerIdx);
    const refs = pdfGetRefs(dict, "Root");
    if (refs.length) rootNum = refs[0];
  }
  if (rootNum === null) {
    for (const [num, offset] of objects) {
      const { dict } = pdfParseDictAt(pdfStr, offset);
      if (/\/Type\s*\/Catalog/.test(dict)) { rootNum = num; break; }
    }
  }

  const pageObjNums = [];
  function walk(objNum, depth) {
    if (depth > 50 || objNum === undefined) return;
    const offset = objects.get(objNum);
    if (offset === undefined) return;
    const { dict } = pdfParseDictAt(pdfStr, offset);
    if (/\/Type\s*\/Pages/.test(dict)) {
      for (const kid of pdfGetRefs(dict, "Kids")) walk(kid, depth + 1);
    } else if (/\/Type\s*\/Page\b/.test(dict)) {
      pageObjNums.push(objNum);
    } else if (pdfGetRefs(dict, "Kids").length) {
      for (const kid of pdfGetRefs(dict, "Kids")) walk(kid, depth + 1);
    }
  }
  if (rootNum !== null) {
    const rootOffset = objects.get(rootNum);
    if (rootOffset !== undefined) {
      const { dict } = pdfParseDictAt(pdfStr, rootOffset);
      const pagesRefs = pdfGetRefs(dict, "Pages");
      if (pagesRefs.length) walk(pagesRefs[0], 0);
    }
  }
  if (pageObjNums.length === 0) {
    for (const [num, offset] of [...objects.entries()].sort((a, b) => a[0] - b[0])) {
      const { dict } = pdfParseDictAt(pdfStr, offset);
      if (/\/Type\s*\/Page\b/.test(dict)) pageObjNums.push(num);
    }
  }
  if (pageObjNums.length === 0) {
    throw new Error("No se pudo leer la estructura de páginas del PDF (puede ser un PDF escaneado/imagen, o tener un formato no compatible).");
  }
  if (pageObjNums.length > 60) {
    throw new Error("El PDF tiene demasiadas páginas para importar de una vez (máximo 60). Divídelo o pega el texto manualmente.");
  }

  const fontCache = new Map();

  async function getFontMapForPage(pageDict) {
    const result = new Map();
    let resourcesDict = null;
    const resRefs = pdfGetRefs(pageDict, "Resources");
    if (resRefs.length) {
      const r = await pdfGetObjectDictAndStream(pdfStr, objects, resRefs[0], bytes, decryptCtx);
      resourcesDict = r ? r.dict : null;
    } else {
      const m = pageDict.match(/\/Resources\s*(<<[\s\S]*?>>)/);
      if (m) resourcesDict = m[1];
    }
    if (!resourcesDict) return result;

    let fontDict = null;
    const fontRefs = pdfGetRefs(resourcesDict, "Font");
    if (fontRefs.length) {
      const r = await pdfGetObjectDictAndStream(pdfStr, objects, fontRefs[0], bytes, decryptCtx);
      fontDict = r ? r.dict : null;
    } else {
      const m = resourcesDict.match(/\/Font\s*(<<[\s\S]*?>>)/);
      if (m) fontDict = m[1];
    }
    if (!fontDict) return result;

    const entryRe = /\/([A-Za-z0-9#+._-]+)\s+(\d+)\s+\d+\s+R/g;
    let em;
    while ((em = entryRe.exec(fontDict))) {
      const resName = em[1];
      const fontObjNum = parseInt(em[2], 10);
      if (fontCache.has(fontObjNum)) {
        result.set(resName, fontCache.get(fontObjNum));
        continue;
      }
      const fontObj = await pdfGetObjectDictAndStream(pdfStr, objects, fontObjNum, bytes, decryptCtx);
      if (!fontObj) continue;
      const tuRefs = pdfGetRefs(fontObj.dict, "ToUnicode");
      let cmapInfo = { map: new Map(), codeByteLen: 1 };
      if (tuRefs.length) {
        const tuObj = await pdfGetObjectDictAndStream(pdfStr, objects, tuRefs[0], bytes, decryptCtx);
        if (tuObj && tuObj.raw) cmapInfo = pdfParseCMap(u8ToBinaryString(tuObj.raw));
      }
      fontCache.set(fontObjNum, cmapInfo);
      result.set(resName, cmapInfo);
    }
    return result;
  }

  let fullText = "";
  for (const pageNum of pageObjNums) {
    const offset = objects.get(pageNum);
    const { dict: pageDict } = pdfParseDictAt(pdfStr, offset);
    const contentRefs = pdfGetRefs(pageDict, "Contents");
    let pageContent = "";
    for (const cRef of contentRefs) {
      const streamInfo = await pdfGetObjectDictAndStream(pdfStr, objects, cRef, bytes, decryptCtx);
      if (streamInfo && streamInfo.raw) pageContent += u8ToBinaryString(streamInfo.raw) + "\n";
    }
    const fontMap = await getFontMapForPage(pageDict);
    fullText += pdfExtractTextFromContentStream(pageContent, fontMap) + "\n\n";
  }

  fullText = fullText
    .split("\n")
    .map((l) => l.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { text: fullText, pageCount: pageObjNums.length };
}

/* ---------- PDF: igual que extractPdfText, pero devuelve fragmentos con posición (x,y) por
   página en vez de texto plano. Usado por el lector de reportes de crédito (parseCreditReport*). ---------- */
async function extractPdfPositionedPages(bytes) {
  const pdfStr = u8ToBinaryString(bytes);
  const objects = pdfFindObjects(pdfStr);
  if (objects.size === 0) throw new Error("No se reconoce como un PDF válido.");
  const decryptCtx = pdfBuildDecryptContext(pdfStr, objects);

  let rootNum = null;
  const trailerIdx = pdfStr.lastIndexOf("trailer");
  if (trailerIdx !== -1) {
    const { dict } = pdfParseDictAt(pdfStr, trailerIdx);
    const refs = pdfGetRefs(dict, "Root");
    if (refs.length) rootNum = refs[0];
  }
  if (rootNum === null) {
    for (const [num, offset] of objects) {
      const { dict } = pdfParseDictAt(pdfStr, offset);
      if (/\/Type\s*\/Catalog/.test(dict)) { rootNum = num; break; }
    }
  }

  const pageObjNums = [];
  function walk(objNum, depth) {
    if (depth > 50 || objNum === undefined) return;
    const offset = objects.get(objNum);
    if (offset === undefined) return;
    const { dict } = pdfParseDictAt(pdfStr, offset);
    if (/\/Type\s*\/Pages/.test(dict)) {
      for (const kid of pdfGetRefs(dict, "Kids")) walk(kid, depth + 1);
    } else if (/\/Type\s*\/Page\b/.test(dict)) {
      pageObjNums.push(objNum);
    } else if (pdfGetRefs(dict, "Kids").length) {
      for (const kid of pdfGetRefs(dict, "Kids")) walk(kid, depth + 1);
    }
  }
  if (rootNum !== null) {
    const rootOffset = objects.get(rootNum);
    if (rootOffset !== undefined) {
      const { dict } = pdfParseDictAt(pdfStr, rootOffset);
      const pagesRefs = pdfGetRefs(dict, "Pages");
      if (pagesRefs.length) walk(pagesRefs[0], 0);
    }
  }
  if (pageObjNums.length === 0) {
    for (const [num, offset] of [...objects.entries()].sort((a, b) => a[0] - b[0])) {
      const { dict } = pdfParseDictAt(pdfStr, offset);
      if (/\/Type\s*\/Page\b/.test(dict)) pageObjNums.push(num);
    }
  }
  if (pageObjNums.length === 0) {
    throw new Error("No se pudo leer la estructura de páginas del PDF (puede ser un PDF escaneado/imagen, o tener un formato no compatible).");
  }
  if (pageObjNums.length > 60) {
    throw new Error("El PDF tiene demasiadas páginas para importar de una vez (máximo 60).");
  }

  const fontCache = new Map();
  async function getFontMapForPage(pageDict) {
    const result = new Map();
    let resourcesDict = null;
    const resRefs = pdfGetRefs(pageDict, "Resources");
    if (resRefs.length) {
      const r = await pdfGetObjectDictAndStream(pdfStr, objects, resRefs[0], bytes, decryptCtx);
      resourcesDict = r ? r.dict : null;
    } else {
      const m = pageDict.match(/\/Resources\s*(<<[\s\S]*?>>)/);
      if (m) resourcesDict = m[1];
    }
    if (!resourcesDict) return result;
    let fontDict = null;
    const fontRefs = pdfGetRefs(resourcesDict, "Font");
    if (fontRefs.length) {
      const r = await pdfGetObjectDictAndStream(pdfStr, objects, fontRefs[0], bytes, decryptCtx);
      fontDict = r ? r.dict : null;
    } else {
      const m = resourcesDict.match(/\/Font\s*(<<[\s\S]*?>>)/);
      if (m) fontDict = m[1];
    }
    if (!fontDict) return result;
    const entryRe = /\/([A-Za-z0-9#+._-]+)\s+(\d+)\s+\d+\s+R/g;
    let em;
    while ((em = entryRe.exec(fontDict))) {
      const resName = em[1];
      const fontObjNum = parseInt(em[2], 10);
      if (fontCache.has(fontObjNum)) { result.set(resName, fontCache.get(fontObjNum)); continue; }
      const fontObj = await pdfGetObjectDictAndStream(pdfStr, objects, fontObjNum, bytes, decryptCtx);
      if (!fontObj) continue;
      const tuRefs = pdfGetRefs(fontObj.dict, "ToUnicode");
      let cmapInfo = { map: new Map(), codeByteLen: 1 };
      if (tuRefs.length) {
        const tuObj = await pdfGetObjectDictAndStream(pdfStr, objects, tuRefs[0], bytes, decryptCtx);
        if (tuObj && tuObj.raw) cmapInfo = pdfParseCMap(u8ToBinaryString(tuObj.raw));
      }
      fontCache.set(fontObjNum, cmapInfo);
      result.set(resName, cmapInfo);
    }
    return result;
  }

  const pages = [];
  for (const pageNum of pageObjNums) {
    const offset = objects.get(pageNum);
    const { dict: pageDict } = pdfParseDictAt(pdfStr, offset);
    const contentRefs = pdfGetRefs(pageDict, "Contents");
    let pageContent = "";
    for (const cRef of contentRefs) {
      const streamInfo = await pdfGetObjectDictAndStream(pdfStr, objects, cRef, bytes, decryptCtx);
      if (streamInfo && streamInfo.raw) pageContent += u8ToBinaryString(streamInfo.raw) + "\n";
    }
    const fontMap = await getFontMapForPage(pageDict);
    pages.push(pdfExtractPositionedRuns(pageContent, fontMap));
  }

  return { pages, pageCount: pageObjNums.length };
}

/* =====================================================================
   LECTOR DE REPORTES DE CRÉDITO
   Primer formato soportado: "Premium Credit Bureau" / CreditXpert (tri-merge, el formato del
   reporte de muestra real usado para construir esto). Detecta la tabla TRADELINES por
   coordenadas (cada reporte de este proveedor coloca las columnas siempre en las mismas
   posiciones) y separa cada renglón en creditor/cuenta/fechas/saldo/estatus/buró. Diseñado para
   poder agregar más formatos (Credit Karma/Sesame, SmartCredit/IdentityIQ) más adelante sin
   tocar esta función — ver detectCreditReportFormat.
   ===================================================================== */

const CREDIT_ECOA_CODES = new Set(["B", "C", "J", "U", "A", "P", "S", "M", "X", "I", "T"]);

const CREDIT_PCB_BUCKETS = {
  ECOA: [20, 34],
  WHOSE: [34, 46],
  CREDITOR: [46, 160],
  DATE_REPORTED: [160, 215],
  DATE_OPENED: [215, 260],
  HIGH_CREDIT: [260, 315],
  BALANCE: [315, 375],
  PAST_DUE: [375, 415],
  MO_REV: [415, 445],
  LATE30: [445, 465],
  LATE60: [465, 485],
  LATE90: [485, 505],
  STATUS: [505, 600],
};

function creditPcbBucketOf(x) {
  for (const [name, [lo, hi]] of Object.entries(CREDIT_PCB_BUCKETS)) {
    if (x >= lo && x < hi) return name;
  }
  return null;
}

function detectCreditReportFormat(pages) {
  const allText = pages.flat().map((r) => r.text).join(" ");
  if (/PREMIUM CREDIT BUREAU|CreditXpert/i.test(allText) && /TRADELINES/.test(allText)) return "pcb_creditxpert";
  return "unknown";
}

const CREDIT_BUREAU_CODE_NAMES = { XP: "Experian", TU: "TransUnion", EF: "Equifax" };

function bureauCodesToNames(codesStr) {
  return (codesStr || "")
    .split("/")
    .map((c) => c.trim().toUpperCase())
    .filter((c) => CREDIT_BUREAU_CODE_NAMES[c])
    .map((c) => CREDIT_BUREAU_CODE_NAMES[c]);
}

// Extrae las direcciones históricas ("ADDRESS: ... - REPORTED MM/YY - MM/YY") que cada acreedor
// reporta — de aquí sale el historial de direcciones del cliente. Se captura de TODAS las cuentas
// (no solo las negativas), porque una dirección vieja puede venir reportada por una cuenta que
// está al día. En este formato de reporte cada línea "ADDRESS: ..." sale como un solo run de texto
// ya completo (no fragmentado), y vive en páginas de detalle que no siempre repiten el encabezado
// "TRADELINES" — por eso se escanea el documento completo run por run en vez de depender de la
// tabla de tradelines.
const ADDRESS_LINE_RE = /^ADDRESS:\s*(.+?)\s*-\s*REPORTED\s*(\d{1,2}\/\d{2,4})(?:\s*-\s*(\d{1,2}\/\d{2,4}))?$/i;

function extractAddressesFromNotes(notesText, bureaus) {
  const found = [];
  if (!notesText) return found;
  const re = /ADDRESS:\s*(.+?)\s*-\s*REPORTED\s*(\d{1,2}\/\d{2,4})(?:\s*-\s*(\d{1,2}\/\d{2,4}))?/g;
  let m;
  while ((m = re.exec(notesText))) {
    const addressLine = (m[1] || "").replace(/\s+/g, " ").trim();
    if (!addressLine) continue;
    found.push({
      address_line: addressLine,
      bureaus: bureaus.join(", "),
      first_reported: m[2] || "",
      last_reported: m[3] || m[2] || "",
    });
  }
  return found;
}

function extractAddressesFromAllRuns(pages) {
  const found = [];
  for (const runs of pages) {
    for (const r of runs) {
      const m = (r.text || "").trim().match(ADDRESS_LINE_RE);
      if (!m) continue;
      const addressLine = (m[1] || "").replace(/\s+/g, " ").trim();
      if (!addressLine) continue;
      found.push({
        address_line: addressLine,
        bureaus: "",
        first_reported: m[2] || "",
        last_reported: m[3] || m[2] || "",
      });
    }
  }
  return found;
}

function normalizeAddressKey(str) {
  return (str || "")
    .toUpperCase()
    .replace(/[.,#]/g, "")
    .replace(/(\d{5})-\d{4}\b/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupAddresses(list) {
  const byKey = new Map();
  for (const a of list) {
    const key = normalizeAddressKey(a.address_line);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...a, normalized_key: key });
    } else {
      // conserva el rango de fechas más amplio y combina los burós vistos
      if (a.first_reported && (!existing.first_reported || a.first_reported < existing.first_reported)) existing.first_reported = a.first_reported;
      if (a.last_reported && (!existing.last_reported || a.last_reported > existing.last_reported)) existing.last_reported = a.last_reported;
      const bureauSet = new Set([...(existing.bureaus ? existing.bureaus.split(", ") : []), ...(a.bureaus ? a.bureaus.split(", ") : [])].filter(Boolean));
      existing.bureaus = [...bureauSet].join(", ");
    }
  }
  return [...byKey.values()];
}

// Un ítem que reporta en varios burós NO es una sola colección/cargo — cada buró la tiene que
// borrar por su cuenta, se le manda su propia carta, y se cobra su propia tarifa completa. Por
// eso cada ítem detectado se guarda como UNA FILA POR BURÓ (bureaus = un solo nombre, no una
// lista), desde el momento en que se importa — así "Colecciones" del cliente, "Cartas" y el
// detalle de "Ganancias" muestran exactamente el mismo número de ítems/remociones, y cada buró
// puede marcarse como borrado/pagado de forma independiente (uno puede borrarlo antes que otro).
// Si no se detectó ningún buró para el ítem, se guarda igual como una sola fila (mejor que perder
// el ítem) con bureaus vacío.
function pushItemPerBureau(rows, base, bureauNames) {
  const list = bureauNames && bureauNames.length ? bureauNames : [""];
  for (const bureau of list) {
    rows.push({ ...base, bureaus: bureau });
  }
}

// Extrae la sección "INQUIRIES (LAST 120 DAYS)" de una página (si existe). Devuelve [] si dice
// "*** NONE ***" o si la sección no aparece en esa página. Nota: el formato exacto de las filas
// cuando SÍ hay inquiries no se pudo verificar contra un reporte real con datos (el reporte de
// muestra usado para construir esto no tenía ninguno) — mejor esfuerzo a partir de la estructura
// visible del reporte; si detecta algo con forma rara, igual lo importa (mejor que perderlo) para
// que se revise/edite a mano desde Colecciones.
function parseInquiriesFromPage(runs) {
  const header = runs.find((r) => /INQUIRIES/i.test(r.text) && /120\s*DAYS/i.test(r.text));
  if (!header) return [];
  const stopHeaders = runs.filter((r) => r.y < header.y && /(PUBLIC RECORDS|CREDITORS\b|ECOA KEY:)/i.test(r.text));
  const stopY = stopHeaders.length ? Math.max(...stopHeaders.map((r) => r.y)) : -Infinity;
  const sectionRuns = runs.filter((r) => r.y < header.y && r.y > stopY);
  if (!sectionRuns.length) return [];
  const joined = sectionRuns.map((r) => r.text).join(" ").replace(/\s+/g, " ").trim();
  if (!joined || /\*{2,3}\s*NONE\s*\*{2,3}/i.test(joined)) return [];

  const rowsByY = new Map();
  for (const r of sectionRuns) {
    const key = Math.round(r.y * 2) / 2;
    if (!rowsByY.has(key)) rowsByY.set(key, []);
    rowsByY.get(key).push(r);
  }
  const rowTexts = [...rowsByY.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([, rs]) => rs.sort((a, b) => a.x - b.x).map((r) => r.text).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const results = [];
  for (const rowText of rowTexts) {
    const dateMatch = rowText.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4}|\d{1,2}\/\d{2,4})\b/);
    const bureauMatch = rowText.match(/\b((?:XP|TU|EF)(?:\/(?:XP|TU|EF)){0,2})\b/);
    let creditorName = rowText;
    if (dateMatch) creditorName = creditorName.replace(dateMatch[0], " ");
    if (bureauMatch) creditorName = creditorName.replace(bureauMatch[0], " ");
    creditorName = creditorName.replace(/\s+/g, " ").trim();
    if (!creditorName) continue;
    pushItemPerBureau(
      results,
      {
        category: "inquiry",
        creditor_name: creditorName,
        account_number: "",
        status_raw: "INQUIRY",
        balance: "",
        past_due: "",
        date_reported: dateMatch ? dateMatch[0] : "",
        date_opened: "",
        notes: "",
      },
      bureauMatch ? bureauCodesToNames(bureauMatch[0]) : []
    );
  }
  return results;
}

// Busca un run cuyo texto coincida con labelRe y devuelve el texto de los runs a su derecha en el
// mismo renglón (misma y) — sirve para leer valores tipo "ETIQUETA   valor..." por posición.
function extractLabeledRowText(runs, labelRe, stopRe) {
  const labelRun = runs.find((r) => labelRe.test(r.text.trim()));
  if (!labelRun) return null;
  const rowRuns = runs.filter((r) => Math.abs(r.y - labelRun.y) < 1.5 && r.x > labelRun.x);
  if (!rowRuns.length) return null;
  rowRuns.sort((a, b) => a.x - b.x);
  let text = rowRuns.map((r) => r.text).join(" ").replace(/\s+/g, " ").trim();
  if (stopRe) text = text.replace(stopRe, "").trim();
  return text || null;
}

function parseAddressComponents(str) {
  if (!str) return null;
  const m = str.match(/^(.+?),\s*([A-Za-z .'-]+),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
  if (!m) return { address: str.trim(), city: "", state: "", zip: "" };
  return { address: m[1].trim(), city: m[2].trim(), state: m[3].trim(), zip: m[4].trim() };
}

// Lee el bloque de datos personales del encabezado del reporte (nombre del solicitante, SSN, DOB,
// dirección actual/anterior) — se usa SOLO para rellenar campos vacíos del cliente, nunca para
// sobrescribir lo que ya tenga guardado. El bloque se repite en varias páginas; se usa la primera
// que traiga datos.
function parsePersonalInfoFromPages(pages) {
  for (const runs of pages) {
    const currentAddress = extractLabeledRowText(runs, /^CURRENT ADDRESS$/i, /\bLENGTH\b.*$/i);
    const previousAddress = extractLabeledRowText(runs, /^PREVIOUS ADDRESS$/i, /\bLENGTH\b.*$/i);

    const socRuns = runs.filter((r) => /^SOC SEC #$/i.test(r.text.trim()));
    let idLast4 = "", dob = "";
    if (socRuns.length) {
      const applicantSoc = socRuns.reduce((a, b) => (a.x < b.x ? a : b));
      const rowRuns = runs.filter((r) => Math.abs(r.y - applicantSoc.y) < 1.5).sort((a, b) => a.x - b.x);
      const socIdx = rowRuns.findIndex((r) => r === applicantSoc);
      const nextLabelIdx = rowRuns.findIndex((r, i) => i > socIdx && /^(DOB|SOC SEC #)$/i.test(r.text.trim()));
      const ssnRuns = rowRuns.slice(socIdx + 1, nextLabelIdx === -1 ? rowRuns.length : nextLabelIdx);
      const ssnMatch = ssnRuns.map((r) => r.text).join("").trim().match(/(\d{3})-?(\d{2})-?(\d{4})/);
      if (ssnMatch) idLast4 = ssnMatch[3];

      const dobIdx = rowRuns.findIndex((r, i) => i > socIdx && /^DOB$/i.test(r.text.trim()));
      if (dobIdx !== -1) {
        const nextAfterDobIdx = rowRuns.findIndex((r, i) => i > dobIdx && /^(SOC SEC #|DOB)$/i.test(r.text.trim()));
        const dobRuns = rowRuns.slice(dobIdx + 1, nextAfterDobIdx === -1 ? rowRuns.length : nextAfterDobIdx);
        const dm = dobRuns.map((r) => r.text).join("").trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (dm) {
          let [, mo, da, yr] = dm;
          if (yr.length === 2) yr = (Number(yr) > 30 ? "19" : "20") + yr;
          dob = `${yr}-${mo.padStart(2, "0")}-${da.padStart(2, "0")}`;
        }
      }
    }

    if (currentAddress || previousAddress || idLast4 || dob) {
      return { currentAddress, previousAddress, idLast4, dob };
    }
  }
  return { currentAddress: null, previousAddress: null, idLast4: "", dob: "" };
}

// Clasifica el STATUS de un renglón en una categoría de "Colecciones". Devuelve null para
// cuentas que no son negativas (al día, pagadas, cerradas sin incidentes) — esas no se importan.
function categorizeCreditStatus(statusRaw) {
  const s = (statusRaw || "").toUpperCase();
  if (!s) return null;
  if (s.includes("COLLECTION")) return "coleccion";
  if (s.includes("CHARGE OFF") || s.includes("CHARGE-OFF") || s.includes("CHARGEOFF")) return "charge_off";
  if (s.includes("REPOSSES")) return "repossesion";
  if (s.includes("FORECLOS")) return "foreclosure";
  if (s.includes("BANKRUPT")) return "bancarrota";
  if (s.includes("SETTLED")) return "liquidada";
  if (s.includes("DELINQ") || s.startsWith("PD WAS") || s.includes("PAST DUE") || /\bLATE\b/.test(s)) return "pago_tardio";
  if (s === "AS AGREED" || s === "PAID" || s === "CURRENT" || s === "CLOSED" || s === "PAID AS AGREED" || s.startsWith("PAID ")) return null;
  return "otro"; // estatus no reconocido: se importa igual para revisión manual, mejor que perderlo
}

function parseCreditReportPCB(pages) {
  const rows = [];
  const addressRows = [];
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const runs = pages[pageIdx];

    // Los inquiries viven en su propia sección de la página, no dentro de TRADELINES.
    rows.push(...parseInquiriesFromPage(runs));

    const tlRun = runs.find((r) => r.text.trim() === "TRADELINES");
    if (!tlRun) continue;
    const sectionRuns = runs.filter((r) => r.y < tlRun.y);

    const anchors = sectionRuns
      .filter((r) => {
        if (creditPcbBucketOf(r.x) !== "ECOA" || !CREDIT_ECOA_CODES.has(r.text.trim())) return false;
        return sectionRuns.some((w) => creditPcbBucketOf(w.x) === "WHOSE" && Math.abs(w.y - r.y) < 0.5);
      })
      .sort((a, b) => b.y - a.y);

    for (let i = 0; i < anchors.length; i++) {
      const rowY = anchors[i].y;
      const nextY = i + 1 < anchors.length ? anchors[i + 1].y : -Infinity;
      const structured = sectionRuns.filter((r) => r.y <= rowY + 1 && r.y > rowY - 11);
      const notesRuns = sectionRuns
        .filter((r) => r.y <= rowY - 11 && r.y > nextY)
        .sort((a, b) => b.y - a.y || a.x - b.x);

      const top = {}, bottom = {};
      for (const r of structured) {
        const b = creditPcbBucketOf(r.x);
        if (!b) continue;
        const isTop = r.y > rowY - 5;
        const slot = isTop ? top : bottom;
        slot[b] = (slot[b] || "") + r.text;
      }

      const statusRaw = (top.STATUS || "").trim();
      const sourceRaw = (bottom.STATUS || "").trim(); // ej. "XP/TU/EF"
      const bureaus = bureauCodesToNames(sourceRaw);

      let notes = notesRuns.map((r) => r.text).join(" ").replace(/\s+/g, " ").trim();

      // Direcciones históricas: se capturan de TODAS las cuentas (no solo las negativas), porque
      // una dirección vieja puede venir reportada por una cuenta que está al día.
      addressRows.push(...extractAddressesFromNotes(notes, bureaus));

      const category = categorizeCreditStatus(statusRaw);
      if (!category) continue; // cuenta al día / pagada / cerrada sin incidentes: no se importa como ítem negativo

      const boundaryRe = /(ECOA KEY:|PREMIUM CREDIT BUREAU:|INQUIRIES|PUBLIC RECORDS|FILE #|B=BORROWER)/;
      const bIdx = notes.search(boundaryRe);
      if (bIdx !== -1) notes = notes.slice(0, bIdx).trim();

      let accountNumber = (bottom.CREDITOR || "").trim();
      if (!/\d{5,}/.test(accountNumber)) {
        const m = notes.match(/^(\d{5,})\s*/);
        if (m) {
          accountNumber = m[1];
          notes = notes.slice(m[0].length).trim();
        }
      }

      pushItemPerBureau(
        rows,
        {
          category,
          creditor_name: (top.CREDITOR || "").trim(),
          account_number: accountNumber,
          status_raw: statusRaw,
          balance: (top.BALANCE || "").trim(),
          past_due: (top.PAST_DUE || "").trim(),
          date_reported: (top.DATE_REPORTED || "").trim(),
          date_opened: (top.DATE_OPENED || "").trim(),
          notes,
        },
        bureaus
      );
    }
  }
  return { items: rows, addresses: addressRows };
}

function parseCreditReport(pages) {
  const format = detectCreditReportFormat(pages);
  if (format === "pcb_creditxpert") {
    const { items, addresses: addressesFromNotes } = parseCreditReportPCB(pages);
    const addresses = dedupAddresses([...addressesFromNotes, ...extractAddressesFromAllRuns(pages)]);
    const personalInfo = parsePersonalInfoFromPages(pages);
    return { format, items, addresses, personalInfo };
  }
  return { format: "unknown", items: [], addresses: [], personalInfo: null };
}

/* ---------- endpoint: POST /api/clients/:id/credit-report/import (multipart/form-data, campo "file") ---------- */

async function creditReportImport(request, env, user, clientId) {
  const client = await env.DB.prepare(`SELECT * FROM clients WHERE id = ?`).bind(clientId).first();
  if (!client) return errorJson("Cliente no encontrado.", 404);

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return errorJson("No se pudo leer el archivo enviado. Sube un archivo .pdf.");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return errorJson("Selecciona el PDF del reporte de crédito.");

  const MAX_SIZE = 20 * 1024 * 1024; // 20 MB
  if (file.size > MAX_SIZE) return errorJson("El archivo es demasiado grande (máximo 20 MB).");

  const fileName = file.name || "reporte.pdf";
  const isPdf = fileName.toLowerCase().endsWith(".pdf") || file.type === "application/pdf";
  if (!isPdf) return errorJson("Por ahora solo se puede importar el reporte en formato PDF.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  let parsed;
  try {
    const { pages } = await extractPdfPositionedPages(bytes);
    parsed = parseCreditReport(pages);
  } catch (e) {
    return errorJson(`No se pudo leer este PDF: ${e.message}`, 422);
  }

  if (parsed.format === "unknown") {
    return errorJson(
      "Este reporte no tiene un formato que la app reconozca todavía (por ahora solo lee reportes tipo 'Premium Credit Bureau' / CreditXpert, como el que se usó para construir esta función). Puedes agregar los ítems manualmente desde 'Colecciones'.",
      422
    );
  }
  // --- ítems negativos (colecciones, charge-offs, pagos tardíos, inquiries, etc.) ---
  let inserted = 0, skippedDuplicates = 0;
  const insertedItems = [];
  for (const item of parsed.items) {
    const existing = await env.DB.prepare(
      `SELECT id FROM credit_items WHERE client_id = ? AND category = ? AND creditor_name = ?
       AND (account_number = ? OR (account_number IS NULL AND ? = ''))
       AND IFNULL(bureaus, '') = ?
       AND (? != 'inquiry' OR IFNULL(date_reported, '') = ?)`
    )
      .bind(clientId, item.category, item.creditor_name, item.account_number, item.account_number, item.bureaus || "", item.category, item.date_reported || "")
      .first();
    if (existing) { skippedDuplicates++; continue; }
    const result = await env.DB.prepare(
      `INSERT INTO credit_items (client_id, category, creditor_name, account_number, status_raw, balance, past_due, date_reported, date_opened, bureaus, notes, source_report)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(clientId, item.category, item.creditor_name || null, item.account_number || null, item.status_raw || null, item.balance || null, item.past_due || null, item.date_reported || null, item.date_opened || null, item.bureaus || null, item.notes || null, fileName)
      .run();
    inserted++;
    insertedItems.push(await env.DB.prepare(`SELECT * FROM credit_items WHERE id = ?`).bind(result.meta.last_row_id).first());
  }

  // --- reconciliación de ítems negativos: si un ítem que veníamos rastreando de un reporte
  // anterior ya no aparece en este reporte nuevo, es porque la disputa funcionó y el buró lo
  // borró — se marca solo como "eliminado" (esto es lo que después alimenta la sección de
  // cobros: solo se cobra por lo que de verdad se borró). Si un ítem que estaba marcado
  // "eliminado" reaparece (por ejemplo si se reimporta un reporte viejo por error), se revive. ---
  // El buró entra en la llave siempre (no solo para inquiries) porque ahora cada buró de un mismo
  // ítem es una fila independiente — si no se distinguiera por buró, la reconciliación pensaría
  // que la fila de Equifax "reemplaza" a la de TransUnion (mismo acreedor/cuenta) y marcaría una
  // como borrada sin serlo.
  function creditItemKey(category, creditorName, accountNumber, dateReported, bureau) {
    const norm = (s) => String(s || "").trim().toLowerCase();
    let key = `${norm(category)}|${norm(creditorName)}|${norm(accountNumber)}|${norm(bureau)}`;
    if (norm(category) === "inquiry") key += `|${norm(dateReported)}`;
    return key;
  }
  let itemsRemoved = 0, itemsRevived = 0;
  {
    const seenItemKeys = new Set(parsed.items.map((it) => creditItemKey(it.category, it.creditor_name, it.account_number, it.date_reported, it.bureaus)));
    const { results: existingItems } = await env.DB.prepare(
      `SELECT * FROM credit_items WHERE client_id = ? AND source_report IS NOT NULL AND source_report != 'manual'`
    )
      .bind(clientId)
      .all();
    for (const existing of existingItems || []) {
      const key = creditItemKey(existing.category, existing.creditor_name, existing.account_number, existing.date_reported, existing.bureaus);
      const stillPresent = seenItemKeys.has(key);
      if (!stillPresent && existing.removed_status !== "eliminado") {
        await env.DB.prepare(`UPDATE credit_items SET removed_status = 'eliminado', updated_at = datetime('now') WHERE id = ?`).bind(existing.id).run();
        itemsRemoved++;
      } else if (stillPresent && existing.removed_status === "eliminado") {
        await env.DB.prepare(`UPDATE credit_items SET removed_status = 'activo', updated_at = datetime('now') WHERE id = ?`).bind(existing.id).run();
        itemsRevived++;
      }
    }
  }

  // --- historial de direcciones: agrega/actualiza las que aparecen en este reporte, y marca como
  // "eliminada" las que ya rastreábamos (de un reporte anterior) pero que ya no aparecen — así se
  // detecta automáticamente cuando una disputa de dirección vieja funcionó. ---
  let addressesAdded = 0, addressesUpdated = 0, addressesRemoved = 0;
  if (parsed.addresses.length) {
    const { results: existingAddresses } = await env.DB.prepare(`SELECT * FROM client_addresses WHERE client_id = ?`).bind(clientId).all();
    const existingByKey = new Map((existingAddresses || []).map((a) => [a.normalized_key, a]));
    const seenKeys = new Set();

    for (const addr of parsed.addresses) {
      const key = addr.normalized_key || normalizeAddressKey(addr.address_line);
      if (!key) continue;
      seenKeys.add(key);
      const existing = existingByKey.get(key);
      if (existing) {
        await env.DB.prepare(
          `UPDATE client_addresses SET last_reported = ?, bureaus = ?, status = CASE WHEN status = 'eliminada' THEN 'activa' ELSE status END, updated_at = datetime('now') WHERE id = ?`
        )
          .bind(addr.last_reported || existing.last_reported, addr.bureaus || existing.bureaus, existing.id)
          .run();
        addressesUpdated++;
      } else {
        await env.DB.prepare(
          `INSERT INTO client_addresses (client_id, address_line, normalized_key, bureaus, source, status, first_reported, last_reported)
           VALUES (?, ?, ?, ?, 'reporte_credito', 'activa', ?, ?)`
        )
          .bind(clientId, addr.address_line, key, addr.bureaus || null, addr.first_reported || null, addr.last_reported || null)
          .run();
        addressesAdded++;
      }
    }

    for (const existing of existingAddresses || []) {
      if (existing.status !== "eliminada" && existing.source === "reporte_credito" && !seenKeys.has(existing.normalized_key)) {
        await env.DB.prepare(`UPDATE client_addresses SET status = 'eliminada', notes = ?, updated_at = datetime('now') WHERE id = ?`)
          .bind(`Ya no aparece en el reporte importado el ${new Date().toISOString().slice(0, 10)}.`, existing.id)
          .run();
        addressesRemoved++;
      }
    }
  }

  // --- rellena datos personales del cliente que estén vacíos (nunca sobrescribe lo que ya tenga) ---
  const clientFieldsFilled = [];
  if (parsed.personalInfo) {
    const pi = parsed.personalInfo;
    const updates = {};
    if (pi.idLast4 && !client.id_last4) { updates.id_last4 = pi.idLast4; clientFieldsFilled.push("ID/SSN (últ. 4)"); }
    if (pi.dob && !client.date_of_birth) { updates.date_of_birth = pi.dob; clientFieldsFilled.push("fecha de nacimiento"); }
    if (pi.currentAddress && !client.address) {
      const comp = parseAddressComponents(pi.currentAddress);
      if (comp) {
        updates.address = comp.address;
        if (comp.city && !client.city) updates.city = comp.city;
        if (comp.state && !client.state) updates.state = comp.state;
        if (comp.zip && !client.zip) updates.zip = comp.zip;
        clientFieldsFilled.push("dirección");
      }
    }
    if (Object.keys(updates).length) {
      const setSql = Object.keys(updates).map((k) => `${k} = ?`).join(", ");
      await env.DB.prepare(`UPDATE clients SET ${setSql}, updated_at = datetime('now') WHERE id = ?`)
        .bind(...Object.values(updates), clientId)
        .run();
    }
  }

  const message =
    inserted === 0 && skippedDuplicates === 0
      ? "Se leyó el reporte pero no se encontraron cuentas negativas (colecciones, charge-offs, pagos tardíos, inquiries) para importar."
      : null;

  await logActivity(env.DB, {
    entityType: "client",
    entityId: clientId,
    action: "reporte_credito_importado",
    detail:
      `${fileName} — ${inserted} ítem(s) nuevo(s), ${skippedDuplicates} ya existían` +
      (itemsRemoved ? `, ${itemsRemoved} ítem(s) ya no aparecen (marcados eliminados)` : "") +
      (addressesRemoved ? `, ${addressesRemoved} dirección(es) ya no aparecen (marcadas eliminadas)` : ""),
    userId: user.uid,
  });

  return json({
    inserted,
    skipped_duplicates: skippedDuplicates,
    items: insertedItems,
    format: parsed.format,
    message,
    items_removed: itemsRemoved,
    items_revived: itemsRevived,
    addresses_added: addressesAdded,
    addresses_updated: addressesUpdated,
    addresses_removed: addressesRemoved,
    client_fields_filled: clientFieldsFilled,
  });
}

/* ================================ COLECCIONES (credit_items) ================================ */

async function creditItemsList(request, env) {
  const url = new URL(request.url);
  const clientId = url.searchParams.get("client_id");
  const category = url.searchParams.get("category");
  let sql = `SELECT ci.*, c.full_name as client_name,
    (SELECT COUNT(*) FROM letters l WHERE l.credit_item_id = ci.id) as letters_count
    FROM credit_items ci JOIN clients c ON c.id = ci.client_id WHERE 1=1`;
  const params = [];
  if (clientId) { sql += ` AND ci.client_id = ?`; params.push(clientId); }
  if (category) { sql += ` AND ci.category = ?`; params.push(category); }
  sql += ` ORDER BY ci.created_at DESC`;
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  // bureau_count: cuántos burós distintos reportan cada ítem — 1 ítem en 3 burós son 3 remociones
  // cobrables independientes, no 1 (ver bureauCountForItem). El frontend lo usa para mostrar el
  // precio real de cada ítem (tarifa × bureau_count).
  const items = (results || []).map((it) => ({ ...it, bureau_count: bureauCountForItem(it.bureaus) }));
  return json({ credit_items: items });
}

// Migración de una sola vez (botón en Ganancias): los ítems importados o agregados ANTES de esta
// versión pueden tener varios burós juntos en un solo campo de texto (ej. "Equifax, TransUnion,
// Experian" en una sola fila). Desde esta versión cada ítem nuevo ya nace como una fila por buró
// (ver pushItemPerBureau / creditItemCreate) — esto divide los que quedaron del formato viejo, para
// que "Colecciones" del cliente, "Cartas" y el detalle de "Ganancias" muestren y cuenten
// exactamente lo mismo, y cada buró se pueda marcar borrado/pagado por separado. La fila original
// se queda con el primer buró (y con las cartas que ya tenía asociadas); las filas nuevas nacen
// con el mismo estado (activo/eliminado, pagado/pendiente) que tenía la fila original, sin cartas
// — se generan aparte cuando hagan falta. Es seguro correrlo más de una vez: después de la primera
// vez ya no quedan ítems con más de un buró en el mismo campo, así que no hace nada.
async function creditItemsSplitMultiBureau(env, user) {
  const { results } = await env.DB.prepare(`SELECT * FROM credit_items WHERE bureaus LIKE '%,%'`).all();
  let itemsSplit = 0,
    rowsCreated = 0;
  for (const item of results || []) {
    const parts = String(item.bureaus || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length < 2) continue;
    const [first, ...rest] = parts;
    await env.DB.prepare(`UPDATE credit_items SET bureaus = ?, updated_at = datetime('now') WHERE id = ?`).bind(first, item.id).run();
    for (const bureau of rest) {
      await env.DB.prepare(
        `INSERT INTO credit_items (client_id, category, creditor_name, account_number, status_raw, balance, past_due, date_reported, date_opened, bureaus, notes, source_report, removed_status, billing_status, is_disputed)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          item.client_id,
          item.category,
          item.creditor_name,
          item.account_number,
          item.status_raw,
          item.balance,
          item.past_due,
          item.date_reported,
          item.date_opened,
          bureau,
          item.notes,
          item.source_report,
          item.removed_status,
          item.billing_status,
          item.is_disputed
        )
        .run();
      rowsCreated++;
    }
    itemsSplit++;
  }
  await logActivity(env.DB, {
    entityType: "settings",
    entityId: 1,
    action: "items_divididos_por_buro",
    detail: `${itemsSplit} ítem(s) originales → ${rowsCreated} fila(s) nueva(s)`,
    userId: user.uid,
  });
  return json({ items_split: itemsSplit, rows_created: rowsCreated });
}

async function creditItemCreate(request, env, user) {
  const body = await readJson(request);
  const clientId = body.client_id;
  if (!clientId) return errorJson("Selecciona un cliente.");
  const client = await env.DB.prepare(`SELECT id FROM clients WHERE id = ?`).bind(clientId).first();
  if (!client) return errorJson("Cliente no encontrado.", 404);
  const category = (body.category || "otro").trim();
  const creditorName = (body.creditor_name || "").trim();
  if (!creditorName) return errorJson("El nombre del acreedor/cobrador es requerido.");

  // Igual que al importar un reporte: si se escriben varios burós (ej. "Equifax, TransUnion"), se
  // crea UN ÍTEM POR BURÓ — son remociones independientes, cada una con su propia tarifa — no un
  // solo ítem con los burós juntos en un campo de texto.
  const bureauList = (body.bureaus || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const bureausToCreate = bureauList.length ? bureauList : [body.bureaus || ""];

  const createdItems = [];
  for (const bureau of bureausToCreate) {
    const result = await env.DB.prepare(
      `INSERT INTO credit_items (client_id, category, creditor_name, account_number, status_raw, balance, past_due, date_reported, date_opened, bureaus, notes, source_report)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`
    )
      .bind(clientId, category, creditorName, body.account_number || null, body.status_raw || null, body.balance || null, body.past_due || null, body.date_reported || null, body.date_opened || null, bureau || null, body.notes || null)
      .run();
    createdItems.push(await env.DB.prepare(`SELECT * FROM credit_items WHERE id = ?`).bind(result.meta.last_row_id).first());
  }
  await logActivity(env.DB, {
    entityType: "client",
    entityId: clientId,
    action: "item_credito_agregado",
    detail: createdItems.length > 1 ? `${creditorName} (${createdItems.length} burós)` : creditorName,
    userId: user.uid,
  });
  return json({ credit_item: createdItems[0], credit_items: createdItems });
}

async function creditItemUpdate(request, env, user, id) {
  const existing = await env.DB.prepare(`SELECT * FROM credit_items WHERE id = ?`).bind(id).first();
  if (!existing) return errorJson("Ítem no encontrado.", 404);
  const body = await readJson(request);
  const creditorName = (body.creditor_name || "").trim();
  if (!creditorName) return errorJson("El nombre del acreedor/cobrador es requerido.");
  await env.DB.prepare(
    `UPDATE credit_items SET category=?, creditor_name=?, account_number=?, status_raw=?, balance=?, past_due=?, date_reported=?, date_opened=?, bureaus=?, notes=?, is_disputed=?, updated_at=datetime('now') WHERE id=?`
  )
    .bind(
      body.category || existing.category,
      creditorName,
      body.account_number || null,
      body.status_raw || null,
      body.balance || null,
      body.past_due || null,
      body.date_reported || null,
      body.date_opened || null,
      body.bureaus || null,
      body.notes || null,
      body.is_disputed ? 1 : 0,
      id
    )
    .run();
  await logActivity(env.DB, { entityType: "client", entityId: existing.client_id, action: "item_credito_actualizado", detail: creditorName, userId: user.uid });
  const item = await env.DB.prepare(`SELECT * FROM credit_items WHERE id = ?`).bind(id).first();
  return json({ credit_item: item });
}

async function creditItemDelete(env, user, id) {
  const existing = await env.DB.prepare(`SELECT * FROM credit_items WHERE id = ?`).bind(id).first();
  if (!existing) return errorJson("Ítem no encontrado.", 404);
  await env.DB.prepare(`DELETE FROM credit_items WHERE id = ?`).bind(id).run();
  await logActivity(env.DB, { entityType: "client", entityId: existing.client_id, action: "item_credito_eliminado", detail: existing.creditor_name, userId: user.uid });
  return json({ ok: true });
}

async function creditItemSetBillingStatus(request, env, user, id) {
  const existing = await env.DB.prepare(`SELECT * FROM credit_items WHERE id = ?`).bind(id).first();
  if (!existing) return errorJson("Ítem no encontrado.", 404);
  const body = await readJson(request);
  const status = body.billing_status === "pagado" ? "pagado" : "pendiente";
  await env.DB.prepare(`UPDATE credit_items SET billing_status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, id).run();
  await logActivity(env.DB, {
    entityType: "client",
    entityId: existing.client_id,
    action: status === "pagado" ? "item_credito_marcado_pagado" : "item_credito_marcado_pendiente",
    detail: existing.creditor_name,
    userId: user.uid,
  });
  const item = await env.DB.prepare(`SELECT * FROM credit_items WHERE id = ?`).bind(id).first();
  return json({ credit_item: item });
}

/* ================================ TARIFAS Y GANANCIAS (cobro por remoción exitosa) ================================ */

// Todas las categorías de ítems negativos que puede detectar el lector de reportes (o agregarse a
// mano) — deben ser cobrables, no solo colección/pago tardío/inquiry, para que ninguna carta
// generada quede fuera del cálculo de ganancias. La columna en pricing_settings es siempre
// "fee_<categoria>".
const ALL_PRICING_CATEGORIES = ["coleccion", "charge_off", "pago_tardio", "liquidada", "repossesion", "foreclosure", "bancarrota", "inquiry", "otro"];
const PRICING_FEE_COLUMN = Object.fromEntries(ALL_PRICING_CATEGORIES.map((cat) => [cat, `fee_${cat}`]));
const PRICING_CATEGORY_LABEL = {
  coleccion: "Colecciones",
  charge_off: "Charge-offs",
  pago_tardio: "Pagos tardíos",
  liquidada: "Liquidadas (settled)",
  repossesion: "Repossesiones",
  foreclosure: "Foreclosures",
  bancarrota: "Bancarrotas",
  inquiry: "Inquiries",
  otro: "Otros",
};
const PRICING_DEFAULTS = {
  coleccion: 80,
  charge_off: 70,
  pago_tardio: 40,
  liquidada: 50,
  repossesion: 120,
  foreclosure: 150,
  bancarrota: 100,
  inquiry: 20,
  otro: 30,
};

async function getPricingSettings(env) {
  let row = await env.DB.prepare(`SELECT * FROM pricing_settings WHERE id = 1`).first();
  if (!row) {
    const cols = ALL_PRICING_CATEGORIES.map((cat) => `fee_${cat}`);
    const placeholders = cols.map(() => "?").join(", ");
    await env.DB
      .prepare(`INSERT OR IGNORE INTO pricing_settings (id, ${cols.join(", ")}) VALUES (1, ${placeholders})`)
      .bind(...ALL_PRICING_CATEGORIES.map((cat) => PRICING_DEFAULTS[cat]))
      .run();
    row = await env.DB.prepare(`SELECT * FROM pricing_settings WHERE id = 1`).first();
  }
  // Cliente en una base de datos que todavía no corrió la migración de las categorías nuevas:
  // faltan columnas en la fila — rellena con los valores por defecto para no romper el cálculo.
  ALL_PRICING_CATEGORIES.forEach((cat) => {
    const col = `fee_${cat}`;
    if (row[col] === undefined || row[col] === null) row[col] = PRICING_DEFAULTS[cat];
  });
  return row;
}

async function pricingGet(env) {
  return json({ pricing: await getPricingSettings(env) });
}

async function pricingUpdate(request, env, user) {
  const body = await readJson(request);
  const fee = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const current = await getPricingSettings(env);
  const values = ALL_PRICING_CATEGORIES.map((cat) => fee(body[`fee_${cat}`], current[`fee_${cat}`]));
  const setClause = ALL_PRICING_CATEGORIES.map((cat) => `fee_${cat}=?`).join(", ");
  await env.DB.prepare(`UPDATE pricing_settings SET ${setClause}, updated_at=datetime('now') WHERE id=1`)
    .bind(...values)
    .run();
  await logActivity(env.DB, { entityType: "settings", entityId: 1, action: "tarifas_actualizadas", userId: user.uid });
  return json({ pricing: await getPricingSettings(env) });
}

function feeForCategory(category, pricing) {
  const col = PRICING_FEE_COLUMN[category];
  return col ? Number(pricing[col]) || 0 : 0;
}

// Un ítem negativo que reporta, por ejemplo, Equifax + TransUnion + Experian NO es una sola
// colección — son 3 remociones independientes (se dispara una carta por cada buró, y cada buró
// tiene que borrarlo por su cuenta), así que se cobra la tarifa completa por cada uno: 3 × la
// tarifa, no 1 × la tarifa. Esta función cuenta cuántos burós distintos hay en el campo "bureaus"
// del ítem (texto libre tipo "Equifax, TransUnion"); si el ítem no tiene ese dato, se cuenta como
// 1 para no perder la ganancia en vez de asumir 0.
const KNOWN_BUREAUS = ["Equifax", "TransUnion", "Experian"];
function bureauCountForItem(bureausRaw) {
  const parts = String(bureausRaw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!parts.length) return 1;
  const seen = new Set();
  parts.forEach((p) => {
    const known = KNOWN_BUREAUS.find((b) => b.toLowerCase() === p.toLowerCase());
    seen.add(known || p.toLowerCase());
  });
  return seen.size || 1;
}

// Trae los ítems crudos (uno por fila, con su campo de burós) para el cálculo de ganancias. No se
// agrega con COUNT(*) en SQL porque la cantidad a cobrar depende de bureauCountForItem — no se
// puede contar burós dentro de una consulta SQL simple. Es la base tanto del resumen por
// categoría como del desglose por cliente. Si se pasa clientId, solo trae los de ese cliente.
async function getCreditItemsForEarnings(env, clientId) {
  let sql = `SELECT ci.client_id, c.full_name as client_name, ci.category, ci.removed_status, ci.billing_status, ci.bureaus
    FROM credit_items ci JOIN clients c ON c.id = ci.client_id WHERE 1=1`;
  const params = [];
  if (clientId) {
    sql += ` AND ci.client_id = ?`;
    params.push(clientId);
  }
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return results || [];
}

// Resumen de ganancias por categoría (colección, charge-off, pago tardío, liquidada, repossesión,
// foreclosure, bancarrota, inquiry, otro — todas cobrables, cada una con su propia tarifa). Para
// cada una separa:
//   - "pendiente" (potencial): ítems que TODAVÍA están en el reporte (removed_status='activo') —
//     lo que ganarías SI se llegan a borrar, pero todavía no es un hecho. Cuenta TODOS los ítems
//     del cliente en esa categoría, se hayan disputado ya o no — es la ganancia posible completa.
//   - "real": ítems que YA se detectaron borrados del reporte (removed_status='eliminado') — esto
//     ya pasó, es ganancia real, y se subdivide en cobrado (billing_status='pagado') y por cobrar.
// Cada ítem cuenta una vez POR CADA BURÓ que lo reporta (ver bureauCountForItem) — un ítem en los
// 3 burós son 3 remociones independientes, no 1.
// Si se pasa clientId, es el resumen de ese cliente; si no, es el global (todos los clientes).
async function creditItemsEarnings(request, env, clientId) {
  const pricing = await getPricingSettings(env);
  const items = await getCreditItemsForEarnings(env, clientId);

  const byCategory = {};
  ALL_PRICING_CATEGORIES.forEach((cat) => (byCategory[cat] = { activo: 0, pagado: 0, porCobrar: 0 }));
  items.forEach((it) => {
    if (!byCategory[it.category]) return; // categoría desconocida (no debería pasar)
    const n = bureauCountForItem(it.bureaus);
    if (it.removed_status === "eliminado") {
      if (it.billing_status === "pagado") byCategory[it.category].pagado += n;
      else byCategory[it.category].porCobrar += n;
    } else {
      byCategory[it.category].activo += n;
    }
  });

  const categories = Object.entries(byCategory).map(([category, c]) => {
    const fee = feeForCategory(category, pricing);
    const realCount = c.pagado + c.porCobrar;
    return {
      category,
      label: PRICING_CATEGORY_LABEL[category],
      fee,
      pending_count: c.activo,
      pending_amount: fee * c.activo,
      real_count: realCount,
      real_amount: fee * realCount,
      paid_count: c.pagado,
      paid_amount: fee * c.pagado,
      owed_count: c.porCobrar,
      owed_amount: fee * c.porCobrar,
    };
  });

  const totals = categories.reduce(
    (acc, c) => ({
      pending: acc.pending + c.pending_amount,
      real: acc.real + c.real_amount,
      paid: acc.paid + c.paid_amount,
      owed: acc.owed + c.owed_amount,
      pending_count: acc.pending_count + c.pending_count,
      real_count: acc.real_count + c.real_count,
      paid_count: acc.paid_count + c.paid_count,
      owed_count: acc.owed_count + c.owed_count,
      total_count: acc.total_count + c.pending_count + c.real_count,
    }),
    { pending: 0, real: 0, paid: 0, owed: 0, pending_count: 0, real_count: 0, paid_count: 0, owed_count: 0, total_count: 0 }
  );

  return json({ categories, totals, pricing });
}

// Desglose por cliente (solo para el resumen global): cuánta ganancia real y pendiente le
// corresponde a cada cliente, para verlos ordenados de mayor a menor ganancia real. Igual que en
// creditItemsEarnings, cada ítem cuenta una vez por cada buró que lo reporta.
async function creditItemsEarningsByClient(env) {
  const pricing = await getPricingSettings(env);
  const rows = await getCreditItemsForEarnings(env, null);

  const byClient = new Map();
  rows.forEach((row) => {
    const fee = feeForCategory(row.category, pricing);
    if (!PRICING_FEE_COLUMN[row.category]) return;
    const n = bureauCountForItem(row.bureaus);
    if (!byClient.has(row.client_id)) {
      byClient.set(row.client_id, {
        client_id: row.client_id,
        client_name: row.client_name,
        real_amount: 0,
        paid_amount: 0,
        owed_amount: 0,
        pending_amount: 0,
        real_count: 0,
        paid_count: 0,
        owed_count: 0,
        pending_count: 0,
      });
    }
    const c = byClient.get(row.client_id);
    const amount = fee * n;
    if (row.removed_status === "eliminado") {
      c.real_amount += amount;
      c.real_count += n;
      if (row.billing_status === "pagado") {
        c.paid_amount += amount;
        c.paid_count += n;
      } else {
        c.owed_amount += amount;
        c.owed_count += n;
      }
    } else {
      c.pending_amount += amount;
      c.pending_count += n;
    }
  });

  const clients = Array.from(byClient.values())
    .filter((c) => c.real_amount || c.pending_amount)
    .sort((a, b) => b.real_amount - a.real_amount);

  return json({ clients });
}

/* ================================ DOCUMENTOS DEL CLIENTE (ID / comprobante de domicilio) ================================ */

const DOC_TYPES = { id: "identificación", proof_address: "comprobante de domicilio", ssn: "Social Security" };
const DOC_MAX_SIZE = 1.5 * 1024 * 1024; // 1.5 MB (D1 guarda el valor como base64 ~1.33x más grande, bien dentro del límite de 2MB por valor)
const DOC_ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);

async function clientDocumentsList(env, clientId) {
  const { results } = await env.DB.prepare(
    `SELECT id, doc_type, file_name, mime_type, created_at, updated_at FROM client_documents WHERE client_id = ? ORDER BY doc_type`
  )
    .bind(clientId)
    .all();
  return json({ documents: results || [] });
}

async function clientDocumentUpload(request, env, user, clientId) {
  const client = await env.DB.prepare(`SELECT id FROM clients WHERE id = ?`).bind(clientId).first();
  if (!client) return errorJson("Cliente no encontrado.", 404);

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return errorJson("No se pudo leer el archivo enviado.");
  }
  const docType = form.get("doc_type");
  if (!DOC_TYPES[docType]) return errorJson("Tipo de documento inválido.");
  const file = form.get("file");
  if (!file || typeof file === "string") return errorJson("Selecciona una imagen.");
  if (file.size > DOC_MAX_SIZE) return errorJson(`El archivo es demasiado grande (máximo ${(DOC_MAX_SIZE / 1024 / 1024).toFixed(1)} MB). Usa una foto comprimida o de menor resolución.`);
  const mimeType = file.type || "";
  if (!DOC_ALLOWED_MIME.has(mimeType)) return errorJson("Sube una imagen JPG, PNG o WEBP (no PDF ni otros formatos) — es lo que se puede incluir automáticamente al imprimir las cartas.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const base64 = btoa(u8ToBinaryString(bytes));
  const fileName = file.name || DOC_TYPES[docType];

  await env.DB.prepare(`DELETE FROM client_documents WHERE client_id = ? AND doc_type = ?`).bind(clientId, docType).run();
  const result = await env.DB.prepare(
    `INSERT INTO client_documents (client_id, doc_type, file_name, mime_type, file_data) VALUES (?, ?, ?, ?, ?)`
  )
    .bind(clientId, docType, fileName, mimeType, base64)
    .run();
  const id = result.meta.last_row_id;
  await logActivity(env.DB, { entityType: "client", entityId: clientId, action: "documento_subido", detail: DOC_TYPES[docType], userId: user.uid });
  const doc = await env.DB.prepare(`SELECT id, doc_type, file_name, mime_type, created_at, updated_at FROM client_documents WHERE id = ?`).bind(id).first();
  return json({ document: doc });
}

async function clientDocumentDelete(env, user, clientId, docId) {
  const existing = await env.DB.prepare(`SELECT * FROM client_documents WHERE id = ? AND client_id = ?`).bind(docId, clientId).first();
  if (!existing) return errorJson("Documento no encontrado.", 404);
  await env.DB.prepare(`DELETE FROM client_documents WHERE id = ?`).bind(docId).run();
  await logActivity(env.DB, { entityType: "client", entityId: clientId, action: "documento_eliminado", detail: DOC_TYPES[existing.doc_type] || existing.doc_type, userId: user.uid });
  return json({ ok: true });
}

async function clientDocumentFile(env, clientId, docId) {
  const doc = await env.DB.prepare(`SELECT * FROM client_documents WHERE id = ? AND client_id = ?`).bind(docId, clientId).first();
  if (!doc) return new Response("Not found", { status: 404 });
  const binary = atob(doc.file_data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Response(bytes, { headers: { "Content-Type": doc.mime_type, "Cache-Control": "private, max-age=3600" } });
}

/* ================================ CREDIT SCORE (seguimiento manual) ================================ */

async function creditScoresList(env, clientId) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM credit_scores WHERE client_id = ? ORDER BY recorded_on ASC, id ASC`
  )
    .bind(clientId)
    .all();
  return json({ scores: results || [] });
}

async function creditScoreCreate(request, env, user, clientId) {
  const client = await env.DB.prepare(`SELECT id FROM clients WHERE id = ?`).bind(clientId).first();
  if (!client) return errorJson("Cliente no encontrado.", 404);
  const body = await readJson(request);
  const bureau = (body.bureau || "").trim();
  const score = Number(body.score);
  const recordedOn = (body.recorded_on || "").trim();
  if (!bureau) return errorJson("Selecciona el buró.");
  if (!Number.isFinite(score) || score < 250 || score > 900) return errorJson("El score debe ser un número entre 250 y 900.");
  if (!recordedOn) return errorJson("Selecciona la fecha de esta lectura.");
  const result = await env.DB.prepare(
    `INSERT INTO credit_scores (client_id, bureau, score, recorded_on, source, notes) VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(clientId, bureau, score, recordedOn, body.source || null, body.notes || null)
    .run();
  const id = result.meta.last_row_id;
  await logActivity(env.DB, { entityType: "client", entityId: clientId, action: "score_registrado", detail: `${bureau}: ${score}`, userId: user.uid });
  const row = await env.DB.prepare(`SELECT * FROM credit_scores WHERE id = ?`).bind(id).first();
  return json({ score: row });
}

async function creditScoreDelete(env, user, clientId, scoreId) {
  const existing = await env.DB.prepare(`SELECT * FROM credit_scores WHERE id = ? AND client_id = ?`).bind(scoreId, clientId).first();
  if (!existing) return errorJson("Registro no encontrado.", 404);
  await env.DB.prepare(`DELETE FROM credit_scores WHERE id = ?`).bind(scoreId).run();
  await logActivity(env.DB, { entityType: "client", entityId: clientId, action: "score_eliminado", detail: `${existing.bureau}: ${existing.score}`, userId: user.uid });
  return json({ ok: true });
}

/* ================================ DIRECCIONES DEL CLIENTE (historial) ================================ */
// Se llenan automáticamente al importar un reporte de crédito (todas las direcciones que reportan
// sus cuentas, más la actual/anterior del encabezado), y se pueden agregar/editar a mano. Cuando un
// reporte nuevo ya no trae una dirección que antes sí aparecía, se marca sola como "eliminada" —
// así se ve cuando una disputa de dirección vieja funcionó, sin tener que comparar reportes a mano.

const ADDRESS_STATUSES = new Set(["activa", "disputada", "eliminada"]);

async function clientAddressesList(env, clientId) {
  const { results } = await env.DB.prepare(
    `SELECT * FROM client_addresses WHERE client_id = ? ORDER BY (status = 'eliminada'), last_reported DESC, id DESC`
  )
    .bind(clientId)
    .all();
  return json({ addresses: results || [] });
}

async function clientAddressCreate(request, env, user, clientId) {
  const client = await env.DB.prepare(`SELECT id FROM clients WHERE id = ?`).bind(clientId).first();
  if (!client) return errorJson("Cliente no encontrado.", 404);
  const body = await readJson(request);
  const addressLine = (body.address_line || "").trim();
  if (!addressLine) return errorJson("Escribe la dirección.");
  const status = ADDRESS_STATUSES.has(body.status) ? body.status : "activa";
  const key = normalizeAddressKey(addressLine);
  const result = await env.DB.prepare(
    `INSERT INTO client_addresses (client_id, address_line, normalized_key, bureaus, source, status, first_reported, last_reported, notes)
     VALUES (?, ?, ?, ?, 'manual', ?, ?, ?, ?)`
  )
    .bind(clientId, addressLine, key, body.bureaus || null, status, body.first_reported || null, body.last_reported || null, body.notes || null)
    .run();
  const id = result.meta.last_row_id;
  await logActivity(env.DB, { entityType: "client", entityId: clientId, action: "direccion_agregada", detail: addressLine, userId: user.uid });
  const address = await env.DB.prepare(`SELECT * FROM client_addresses WHERE id = ?`).bind(id).first();
  return json({ address });
}

async function clientAddressUpdate(request, env, user, clientId, id) {
  const existing = await env.DB.prepare(`SELECT * FROM client_addresses WHERE id = ? AND client_id = ?`).bind(id, clientId).first();
  if (!existing) return errorJson("Dirección no encontrada.", 404);
  const body = await readJson(request);
  const addressLine = (body.address_line || existing.address_line || "").trim();
  if (!addressLine) return errorJson("Escribe la dirección.");
  const status = ADDRESS_STATUSES.has(body.status) ? body.status : existing.status;
  const key = normalizeAddressKey(addressLine);
  await env.DB.prepare(
    `UPDATE client_addresses SET address_line=?, normalized_key=?, bureaus=?, status=?, first_reported=?, last_reported=?, notes=?, updated_at=datetime('now') WHERE id=?`
  )
    .bind(addressLine, key, body.bureaus ?? existing.bureaus, status, body.first_reported ?? existing.first_reported, body.last_reported ?? existing.last_reported, body.notes ?? existing.notes, id)
    .run();
  await logActivity(env.DB, { entityType: "client", entityId: clientId, action: "direccion_actualizada", detail: addressLine, userId: user.uid });
  const address = await env.DB.prepare(`SELECT * FROM client_addresses WHERE id = ?`).bind(id).first();
  return json({ address });
}

async function clientAddressDelete(env, user, clientId, id) {
  const existing = await env.DB.prepare(`SELECT * FROM client_addresses WHERE id = ? AND client_id = ?`).bind(id, clientId).first();
  if (!existing) return errorJson("Dirección no encontrada.", 404);
  await env.DB.prepare(`DELETE FROM client_addresses WHERE id = ?`).bind(id).run();
  await logActivity(env.DB, { entityType: "client", entityId: clientId, action: "direccion_eliminada", detail: existing.address_line, userId: user.uid });
  return json({ ok: true });
}

/* ================================ LECTURA DE ID/LICENCIA CON IA (autocompletar cliente nuevo) ================================
   Usa el binding de Cloudflare Workers AI (env.AI) para leer una foto de identificación y extraer
   nombre, dirección, fecha de nacimiento, etc. — se muestra al usuario para que los revise antes de
   guardar, nunca se guardan automáticamente sin su confirmación. Si el binding no está configurado
   en este Worker de Cloudflare, devuelve un error claro en vez de fallar feo — la app sigue
   funcionando con captura manual. ---------------------------------------------------------------- */

const ID_OCR_MAX_SIZE = 8 * 1024 * 1024; // 8 MB (no se guarda, solo se procesa y se descarta)
const ID_OCR_ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
// Se usa Moondream en vez de Llama 3.2 Vision: Moondream está pensado específicamente para leer
// texto de documentos/fotos (no solo describir la imagen en general) y no pide aceptar ninguna
// licencia aparte antes de usarlo, a diferencia de Llama 3.2 Vision.
const ID_OCR_MODEL = "@cf/moondream/moondream3.1-9B-A2B";

async function clientExtractFromId(request, env, user) {
  if (!env.AI) {
    return errorJson(
      "La lectura automática de ID no está configurada todavía en este proyecto de Cloudflare (falta el binding de Workers AI). Puedes seguir creando clientes escribiendo los datos a mano — ver INSTRUCCIONES.md para activarla.",
      501
    );
  }
  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return errorJson("No se pudo leer el archivo enviado.");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return errorJson("Selecciona una foto del ID o licencia.");
  if (file.size > ID_OCR_MAX_SIZE) return errorJson("La imagen es demasiado grande (máximo 8 MB).");
  const mimeType = file.type || "";
  if (!ID_OCR_ALLOWED_MIME.has(mimeType)) return errorJson("Sube una imagen JPG, PNG o WEBP.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  const imageDataUri = `data:${mimeType};base64,${btoa(u8ToBinaryString(bytes))}`;

  // Un solo prompt largo pidiendo varios campos a la vez resultó muy poco confiable con este
  // modelo (chico, no afinado para seguir instrucciones complejas): en pruebas reales, en vez de
  // leer la foto, terminaba repitiendo el propio texto de las instrucciones como si fuera la
  // respuesta. Por eso se le hace una pregunta corta y directa POR CADA campo, por separado
  // (así es como este tipo de modelo de "visual question answering" funciona mejor) y se
  // combinan las respuestas al final.
  // "NO_GUESS": instrucción repetida en cada pregunta — este modelo, cuando no está seguro de un
  // dato, a veces inventa algo que "parece" correcto (un nombre de calle genérico, una fecha
  // cualquiera, un número al azar) en vez de admitir que no lo puede leer. Insistir varias veces
  // en que es preferible responder N/A antes que adivinar reduce bastante ese comportamiento.
  const NO_GUESS = " Es muy importante que NO inventes ni adivines nada: si tienes cualquier duda sobre este dato, responde exactamente N/A en vez de arriesgarte a poner algo incorrecto.";
  const ID_OCR_QUESTIONS = [
    {
      key: "full_name",
      question:
        "Mira esta foto de una identificación o licencia de conducir de EE. UU. ¿Cuál es el nombre completo de la persona que aparece impreso? Incluye TODAS las palabras del nombre (primer nombre, segundo nombre si tiene, y apellido(s)) — no omitas ninguna parte. Responde ÚNICAMENTE con el nombre completo, sin ninguna otra palabra ni explicación." +
        NO_GUESS,
    },
    {
      key: "address",
      question:
        "Mira esta foto de una identificación o licencia de conducir de EE. UU. ¿Cuál es la dirección (calle, número, y número de apartamento/unidad/suite si aparece uno — por ejemplo 'APT 2B' o '#4' — pero SIN ciudad, SIN estado, SIN código postal) que aparece impresa? Responde ÚNICAMENTE con esa dirección, sin ninguna otra palabra ni explicación." +
        NO_GUESS,
    },
    {
      key: "city",
      question:
        "Mira esta foto de una identificación o licencia de conducir de EE. UU. ¿Cuál es la ciudad que aparece impresa en la dirección? Responde ÚNICAMENTE con el nombre de la ciudad, sin ninguna otra palabra ni explicación." +
        NO_GUESS,
    },
    {
      key: "state",
      question:
        "Mira esta foto de una identificación o licencia de conducir de EE. UU. ¿Cuál es el código de 2 letras del estado (por ejemplo FL, CA, TX) que aparece impreso en la dirección? Responde ÚNICAMENTE con esas 2 letras, sin ninguna otra palabra ni explicación." +
        NO_GUESS,
    },
    {
      key: "zip",
      question:
        "Mira esta foto de una identificación o licencia de conducir de EE. UU. ¿Cuál es el código postal (ZIP) que aparece impreso en la dirección? Responde ÚNICAMENTE con el código postal, sin ninguna otra palabra ni explicación." +
        NO_GUESS,
    },
    {
      key: "date_of_birth",
      question:
        "Mira esta foto de una identificación o licencia de conducir de EE. UU. Las licencias normalmente muestran varias fechas distintas: fecha de nacimiento (DOB), fecha de emisión (ISS) y fecha de vencimiento (EXP). Necesito ESPECÍFICAMENTE la fecha de nacimiento (DOB) — la fecha en que nació la persona, que debe ser una fecha de hace varias décadas, NO la fecha de emisión ni la de vencimiento de la licencia (esas suelen ser fechas recientes o futuras). Responde ÚNICAMENTE con esa fecha en formato MM/DD/AAAA, sin ninguna otra palabra ni explicación." +
        NO_GUESS,
    },
    {
      key: "id_last4",
      question:
        "Mira esta foto de una identificación o licencia de conducir de EE. UU. ¿Cuáles son los últimos 4 dígitos del número de licencia o de identificación (DL# o ID#) que aparece impreso? Responde ÚNICAMENTE con esos 4 dígitos, sin ninguna otra palabra ni explicación." +
        NO_GUESS,
    },
  ];

  const answers = await Promise.all(
    ID_OCR_QUESTIONS.map(async ({ key, question }) => {
      try {
        const r = await env.AI.run(ID_OCR_MODEL, {
          task: "query",
          image: imageDataUri,
          question,
          reasoning: false,
          stream: false,
          max_tokens: 48,
        });
        // A veces la respuesta viene envuelta como { result: { answer, caption, ... }, success, ... }
        // en vez de venir plana — por eso se busca .answer/.response/.description también un nivel
        // adentro de .result antes de rendirse y convertir todo el objeto a texto.
        const pickAnswer = (obj, depth) => {
          if (!obj || depth > 2) return "";
          if (typeof obj === "string") return obj;
          if (typeof obj.answer === "string") return obj.answer;
          if (typeof obj.response === "string") return obj.response;
          if (typeof obj.description === "string") return obj.description;
          if (obj.result) return pickAnswer(obj.result, depth + 1);
          return "";
        };
        const raw = pickAnswer(r, 0);
        return [key, raw];
      } catch (e) {
        return [key, ""];
      }
    })
  );

  // Limpia cada respuesta: se queda con la primera línea, quita comillas envolventes, descarta
  // respuestas tipo "N/A"/"no legible", y si el modelo de todas formas contestó repitiendo la
  // etiqueta ("Nombre: Juan Pérez") se queda solo con lo que sigue después de los dos puntos.
  function cleanAnswer(raw) {
    let s = (raw || "").split(/\r?\n/)[0].trim();
    s = s.replace(/^["'“”]+|["'“”]+$/g, "").trim();
    s = s.replace(/\.$/, "").trim();
    if (/^(n\/?a|no legible|no disponible|desconocid[oa]|unknown|none|no puedo leer|not (visible|legible|available)|cannot (read|determine))$/i.test(s)) return "";
    const m = s.match(/^[a-záéíóúñ_ ]{2,25}:\s*(.+)$/i);
    if (m) s = m[1].trim();
    return s;
  }

  const fields = Object.fromEntries(answers.map(([key, raw]) => [key, cleanAnswer(raw)]));

  if (!Object.values(fields).some((v) => v)) {
    return errorJson("La IA no pudo leer datos de esta foto. Puedes escribirlos a mano.", 502);
  }

  function normalizeDob(raw) {
    const s = (raw || "").trim();
    if (!s) return "";
    let iso = "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      iso = s;
    } else {
      const m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/); // MM/DD/AAAA o MM-DD-AAAA
      if (m) {
        const [, mm, dd, yyyy] = m;
        iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
      } else {
        const m2 = s.match(/^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})$/); // AAAA/MM/DD
        if (m2) {
          const [, yyyy, mm, dd] = m2;
          iso = `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
        }
      }
    }
    if (!iso) return "";
    // Chequeo de sentido común: una fecha de nacimiento real de un cliente de reparación de
    // crédito no puede ser en el futuro ni corresponder a alguien de menos de 16 ni más de 110
    // años — si cae fuera de ese rango, es casi seguro que el modelo confundió la fecha de
    // nacimiento con la de emisión/vencimiento de la licencia (o inventó una), así que se
    // descarta en vez de guardar un dato claramente erróneo.
    const year = Number(iso.slice(0, 4));
    const thisYear = new Date().getUTCFullYear();
    const age = thisYear - year;
    if (age < 16 || age > 110) return "";
    return iso;
  }

  return json({
    fields: {
      full_name: (fields.full_name || "").trim(),
      address: (fields.address || "").trim(),
      city: (fields.city || "").trim(),
      state: (fields.state || "").trim().toUpperCase().slice(0, 2),
      zip: (fields.zip || "").trim(),
      date_of_birth: normalizeDob(fields.date_of_birth),
      id_last4: (fields.id_last4 || "").replace(/\D/g, "").slice(-4),
    },
  });
}

/* ---------- endpoint: POST /api/templates/import (multipart/form-data, campo "file") ---------- */

async function templateImport(request, env, user) {
  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return errorJson("No se pudo leer el archivo enviado. Sube un archivo .pdf o .docx.");
  }
  const file = form.get("file");
  if (!file || typeof file === "string") return errorJson("Selecciona un archivo .pdf o .docx para importar.");

  const MAX_SIZE = 15 * 1024 * 1024; // 15 MB
  if (file.size > MAX_SIZE) return errorJson("El archivo es demasiado grande (máximo 15 MB).");

  const fileName = file.name || "plantilla";
  const lowerName = fileName.toLowerCase();
  const isDocx = lowerName.endsWith(".docx") || file.type.includes("wordprocessingml");
  const isPdf = lowerName.endsWith(".pdf") || file.type === "application/pdf";
  if (!isDocx && !isPdf) return errorJson("Formato no soportado. Sube un archivo .pdf o .docx.");

  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = "";
  try {
    if (isDocx) {
      text = await extractDocxText(bytes);
    } else {
      const result = await extractPdfText(bytes);
      text = result.text;
    }
  } catch (e) {
    return errorJson(`No se pudo extraer el texto del archivo: ${e.message}`, 422);
  }

  if (!text || text.replace(/\s/g, "").length < 20) {
    return errorJson(
      isPdf
        ? "No se pudo extraer texto de este PDF. Es posible que sea un PDF escaneado (una imagen), lo cual no es compatible. Prueba a subirlo como .docx, o pega el contenido manualmente al crear la plantilla."
        : "No se encontró texto en este archivo .docx.",
      422
    );
  }

  const rawName = (form.get("name") || fileName.replace(/\.(pdf|docx)$/i, "")).toString().trim();
  const name = rawName || "Plantilla importada";

  const result = await env.DB.prepare(
    `INSERT INTO letter_templates (name, category, recipient_hint, subject, body, is_active) VALUES (?, ?, ?, ?, ?, 1)`
  )
    .bind(name, "Importado", null, null, text.slice(0, 100000))
    .run();
  const id = result.meta.last_row_id;
  await logActivity(env.DB, { entityType: "template", entityId: id, action: "plantilla_importada", detail: `${fileName} (${isPdf ? "PDF" : "Word"})`, userId: user.uid });
  const template = await env.DB.prepare(`SELECT * FROM letter_templates WHERE id = ?`).bind(id).first();
  return json({ template });
}


/* ================================ CARTAS ================================ */

async function lettersList(request, env) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const clientId = url.searchParams.get("client_id");
  let sql = `SELECT l.*, c.full_name as client_name,
    (SELECT tracking_number FROM mailings m WHERE m.letter_id = l.id ORDER BY m.id DESC LIMIT 1) as tracking_number,
    (SELECT last_status FROM mailings m WHERE m.letter_id = l.id ORDER BY m.id DESC LIMIT 1) as mailing_status
    FROM letters l JOIN clients c ON c.id = l.client_id WHERE 1=1`;
  const params = [];
  if (status) {
    sql += ` AND l.status = ?`;
    params.push(status);
  }
  if (clientId) {
    sql += ` AND l.client_id = ?`;
    params.push(clientId);
  }
  sql += ` ORDER BY l.created_at DESC`;
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return json({ letters: results || [] });
}

async function letterCreate(request, env, user) {
  const body = await readJson(request);
  const clientId = body.client_id;
  const title = (body.title || "").trim();
  const letterBody = (body.body || "").trim();
  if (!clientId) return errorJson("Selecciona un cliente.");
  if (!title) return errorJson("El título de la carta es requerido.");
  if (!letterBody) return errorJson("El contenido de la carta no puede estar vacío.");
  const client = await env.DB.prepare(`SELECT id FROM clients WHERE id = ?`).bind(clientId).first();
  if (!client) return errorJson("Cliente no encontrado.", 404);

  // Si el frontend no especificó si hay que incluir copia de ID / comprobante de domicilio,
  // se hereda de la plantilla usada — así cualquier vía de creación de cartas (manual, generación
  // inteligente, etc.) queda cubierta sin tener que duplicar esta lógica en cada pantalla.
  let includeIdCopy = body.include_id_copy;
  let includeAddressProof = body.include_address_proof;
  let includeSsnCopy = body.include_ssn_copy;
  if ((includeIdCopy === undefined || includeAddressProof === undefined || includeSsnCopy === undefined) && body.template_id) {
    const tpl = await env.DB.prepare(`SELECT include_id_copy, include_address_proof, include_ssn_copy FROM letter_templates WHERE id = ?`).bind(body.template_id).first();
    if (tpl) {
      if (includeIdCopy === undefined) includeIdCopy = tpl.include_id_copy;
      if (includeAddressProof === undefined) includeAddressProof = tpl.include_address_proof;
      if (includeSsnCopy === undefined) includeSsnCopy = tpl.include_ssn_copy;
    }
  }

  const result = await env.DB.prepare(
    `INSERT INTO letters (client_id, template_id, credit_item_id, title, recipient_name, recipient_address, round_number, body, status, include_id_copy, include_address_proof, include_ssn_copy, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'borrador', ?, ?, ?, ?)`
  )
    .bind(clientId, body.template_id || null, body.credit_item_id || null, title, body.recipient_name || null, body.recipient_address || null, body.round_number ?? 1, letterBody, includeIdCopy ? 1 : 0, includeAddressProof ? 1 : 0, includeSsnCopy ? 1 : 0, body.notes || null)
    .run();
  const id = result.meta.last_row_id;
  if (body.credit_item_id) {
    await env.DB.prepare(`UPDATE credit_items SET is_disputed = 1, updated_at = datetime('now') WHERE id = ?`).bind(body.credit_item_id).run();
  }
  await logActivity(env.DB, { entityType: "letter", entityId: id, action: "carta_creada", detail: title, userId: user.uid });
  const letter = await env.DB.prepare(`SELECT * FROM letters WHERE id = ?`).bind(id).first();
  return json({ letter });
}

async function letterGet(env, id) {
  const letter = await env.DB.prepare(
    `SELECT l.*, c.full_name as client_name, c.address as client_address, c.city as client_city, c.state as client_state, c.zip as client_zip
     FROM letters l JOIN clients c ON c.id = l.client_id WHERE l.id = ?`
  ).bind(id).first();
  if (!letter) return errorJson("Carta no encontrada.", 404);
  const { results: mailings } = await env.DB.prepare(`SELECT * FROM mailings WHERE letter_id = ? ORDER BY id DESC`).bind(id).all();
  const { results: activity } = await env.DB.prepare(
    `SELECT * FROM activity_log WHERE entity_type = 'letter' AND entity_id = ? ORDER BY created_at DESC`
  ).bind(id).all();
  return json({ letter, mailings: mailings || [], activity: activity || [] });
}

async function letterUpdate(request, env, user, id) {
  const existing = await env.DB.prepare(`SELECT * FROM letters WHERE id = ?`).bind(id).first();
  if (!existing) return errorJson("Carta no encontrada.", 404);
  const body = await readJson(request);
  const title = (body.title || "").trim();
  const letterBody = (body.body || "").trim();
  if (!title) return errorJson("El título de la carta es requerido.");
  if (!letterBody) return errorJson("El contenido de la carta no puede estar vacío.");
  await env.DB.prepare(
    `UPDATE letters SET title=?, recipient_name=?, recipient_address=?, round_number=?, body=?, notes=?, updated_at=datetime('now') WHERE id=?`
  )
    .bind(title, body.recipient_name || null, body.recipient_address || null, body.round_number ?? 1, letterBody, body.notes || null, id)
    .run();
  await logActivity(env.DB, { entityType: "letter", entityId: id, action: "carta_actualizada", userId: user.uid });
  const letter = await env.DB.prepare(`SELECT * FROM letters WHERE id = ?`).bind(id).first();
  return json({ letter });
}

async function letterDelete(env, user, id) {
  const existing = await env.DB.prepare(`SELECT * FROM letters WHERE id = ?`).bind(id).first();
  if (!existing) return errorJson("Carta no encontrada.", 404);
  await env.DB.prepare(`DELETE FROM letters WHERE id = ?`).bind(id).run();
  await logActivity(env.DB, { entityType: "letter", entityId: id, action: "carta_eliminada", detail: existing.title, userId: user.uid });
  return json({ ok: true });
}

const VALID_LETTER_STATUSES = ["borrador", "lista", "enviada", "en_transito", "entregada", "devuelta", "respondida", "completada"];

async function letterSetStatus(request, env, user, id) {
  const existing = await env.DB.prepare(`SELECT * FROM letters WHERE id = ?`).bind(id).first();
  if (!existing) return errorJson("Carta no encontrada.", 404);
  const body = await readJson(request);
  const status = body.status;
  if (!VALID_LETTER_STATUSES.includes(status)) return errorJson("Estado inválido.");
  await env.DB.prepare(`UPDATE letters SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(status, id).run();
  await logActivity(env.DB, {
    entityType: "letter",
    entityId: id,
    action: "cambio_estado",
    detail: `${existing.status} → ${status}${body.notes ? ` — ${body.notes}` : ""}`,
    userId: user.uid,
  });
  const letter = await env.DB.prepare(`SELECT * FROM letters WHERE id = ?`).bind(id).first();
  return json({ letter });
}

async function letterSend(request, env, user, id) {
  const letter = await env.DB.prepare(`SELECT * FROM letters WHERE id = ?`).bind(id).first();
  if (!letter) return errorJson("Carta no encontrada.", 404);
  const body = await readJson(request);
  const trackingNumber = (body.tracking_number || "").trim();
  if (!trackingNumber) return errorJson("Ingresa el número de rastreo generado en certifiedmaillabels.com.");
  const result = await env.DB.prepare(
    `INSERT INTO mailings (letter_id, tracking_number, carrier, cost, mailed_at, last_status, last_checked_at) VALUES (?, ?, ?, ?, datetime('now'), 'Enviada', datetime('now'))`
  )
    .bind(id, trackingNumber, body.carrier || "USPS Certified Mail", body.cost || null)
    .run();
  await env.DB.prepare(`UPDATE letters SET status = 'enviada', updated_at = datetime('now') WHERE id = ?`).bind(id).run();
  await logActivity(env.DB, { entityType: "letter", entityId: id, action: "carta_enviada", detail: `Certificado USPS — tracking ${trackingNumber}`, userId: user.uid });
  const mailing = await env.DB.prepare(`SELECT * FROM mailings WHERE id = ?`).bind(result.meta.last_row_id).first();
  return json({ mailing });
}

/* ================================ ENVÍOS (MAILINGS) ================================ */

async function mailingsList(request, env) {
  const url = new URL(request.url);
  const activeOnly = url.searchParams.get("active") === "1";
  let sql = `SELECT m.*, l.title as letter_title, l.status as letter_status, c.full_name as client_name, c.id as client_id
    FROM mailings m JOIN letters l ON l.id = m.letter_id JOIN clients c ON c.id = l.client_id`;
  if (activeOnly) sql += ` WHERE m.last_status NOT IN ('Entregada','entregada') `;
  sql += ` ORDER BY m.created_at DESC`;
  const { results } = await env.DB.prepare(sql).all();
  return json({ mailings: results || [] });
}

// Borra TODO el historial de envíos certificados (los registros de rastreo, no las cartas — las
// cartas y su contenido se quedan intactos, solo se borra el tracking/estado del envío). Útil para
// limpiar registros de prueba o empezar de cero. No se puede deshacer.
async function mailingsDeleteAll(env, user) {
  const { count } = (await env.DB.prepare(`SELECT COUNT(*) as count FROM mailings`).first()) || { count: 0 };
  await env.DB.prepare(`DELETE FROM mailings`).run();
  await logActivity(env.DB, { entityType: "mailing", entityId: 0, action: "envios_borrados_todos", detail: `${count} envío(s) eliminados`, userId: user.uid });
  return json({ deleted: count });
}

const MAILING_STATUS_LABELS = { enviada: "Enviada", en_transito: "En tránsito", entregada: "Entregada", devuelta: "Devuelta" };

async function mailingUpdate(request, env, user, id) {
  const mailing = await env.DB.prepare(`SELECT * FROM mailings WHERE id = ?`).bind(id).first();
  if (!mailing) return errorJson("Envío no encontrado.", 404);
  const body = await readJson(request);
  const statusKey = body.status_key;
  const label = MAILING_STATUS_LABELS[statusKey] || body.last_status || mailing.last_status;
  await env.DB.prepare(
    `UPDATE mailings SET tracking_number = ?, last_status = ?, last_status_detail = ?, last_checked_at = datetime('now'),
       delivered_at = ${statusKey === "entregada" ? "datetime('now')" : "delivered_at"}
     WHERE id = ?`
  )
    .bind(body.tracking_number || mailing.tracking_number, label, body.last_status_detail || null, id)
    .run();
  if (statusKey && ["enviada", "en_transito", "entregada", "devuelta"].includes(statusKey)) {
    await env.DB.prepare(`UPDATE letters SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(statusKey, mailing.letter_id).run();
  }
  await logActivity(env.DB, { entityType: "letter", entityId: mailing.letter_id, action: "actualizacion_envio_manual", detail: label, userId: user.uid });
  const updated = await env.DB.prepare(`SELECT * FROM mailings WHERE id = ?`).bind(id).first();
  return json({ mailing: updated });
}

async function mailingRefresh(env, user, id) {
  const mailing = await env.DB.prepare(`SELECT * FROM mailings WHERE id = ?`).bind(id).first();
  if (!mailing) return errorJson("Envío no encontrado.", 404);
  if (!mailing.tracking_number) return errorJson("Este envío no tiene número de rastreo.");
  let result;
  try {
    result = await fetchTrackingStatus(env, mailing.tracking_number);
  } catch (e) {
    return errorJson(`No se pudo consultar USPS: ${e.message}`, 502);
  }
  if (!result.configured) {
    return errorJson("El rastreo automático de USPS no está configurado (faltan USPS_CLIENT_ID / USPS_CLIENT_SECRET). Actualiza el estado manualmente.", 501);
  }
  await env.DB.prepare(
    `UPDATE mailings SET last_status = ?, last_status_detail = ?, last_checked_at = datetime('now'), raw_tracking_json = ?,
       delivered_at = CASE WHEN ? = 'entregada' THEN datetime('now') ELSE delivered_at END
     WHERE id = ?`
  )
    .bind(result.summary, result.summary, JSON.stringify(result.raw).slice(0, 8000), result.mappedStatus, id)
    .run();
  if (result.mappedStatus) {
    await env.DB.prepare(`UPDATE letters SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(result.mappedStatus, mailing.letter_id).run();
  }
  await logActivity(env.DB, { entityType: "letter", entityId: mailing.letter_id, action: "rastreo_usps_actualizado", detail: result.summary, userId: user.uid });
  const updated = await env.DB.prepare(`SELECT * FROM mailings WHERE id = ?`).bind(id).first();
  return json({ mailing: updated });
}

async function mailingsRefreshAll(env, user) {
  if (!env.USPS_CLIENT_ID || !env.USPS_CLIENT_SECRET) {
    return errorJson("El rastreo automático de USPS no está configurado (faltan USPS_CLIENT_ID / USPS_CLIENT_SECRET).", 501);
  }
  const { results } = await env.DB.prepare(
    `SELECT * FROM mailings WHERE tracking_number IS NOT NULL AND (last_status IS NULL OR last_status NOT IN ('entregada','devuelta')) LIMIT 25`
  ).all();
  let updated = 0;
  let errors = 0;
  for (const mailing of results || []) {
    try {
      const result = await fetchTrackingStatus(env, mailing.tracking_number);
      if (!result.configured) continue;
      await env.DB.prepare(
        `UPDATE mailings SET last_status = ?, last_status_detail = ?, last_checked_at = datetime('now'), raw_tracking_json = ?,
           delivered_at = CASE WHEN ? = 'entregada' THEN datetime('now') ELSE delivered_at END
         WHERE id = ?`
      )
        .bind(result.summary, result.summary, JSON.stringify(result.raw).slice(0, 8000), result.mappedStatus, mailing.id)
        .run();
      if (result.mappedStatus) {
        await env.DB.prepare(`UPDATE letters SET status = ?, updated_at = datetime('now') WHERE id = ?`).bind(result.mappedStatus, mailing.letter_id).run();
      }
      updated++;
    } catch (e) {
      errors++;
    }
  }
  await logActivity(env.DB, { entityType: "mailing", entityId: 0, action: "rastreo_masivo", detail: `${updated} actualizados, ${errors} con error`, userId: user.uid });
  return json({ updated, errors, checked: (results || []).length });
}

/* ================================ DASHBOARD ================================ */

async function dashboardStats(env) {
  const [clientsTotal, clientsActive, lettersByStatus, recentActivity, upcoming] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) as n FROM clients`).first(),
    env.DB.prepare(`SELECT COUNT(*) as n FROM clients WHERE status = 'activo'`).first(),
    env.DB.prepare(`SELECT status, COUNT(*) as n FROM letters GROUP BY status`).all(),
    env.DB.prepare(`SELECT * FROM activity_log ORDER BY created_at DESC LIMIT 12`).all(),
    env.DB.prepare(
      `SELECT l.id, l.title, l.status, c.full_name as client_name FROM letters l JOIN clients c ON c.id = l.client_id WHERE l.status IN ('borrador','lista') ORDER BY l.created_at DESC LIMIT 8`
    ).all(),
  ]);
  const statusCounts = {};
  (lettersByStatus.results || []).forEach((r) => (statusCounts[r.status] = r.n));
  return json({
    clients_total: clientsTotal?.n || 0,
    clients_active: clientsActive?.n || 0,
    letters_by_status: statusCounts,
    letters_total: Object.values(statusCounts).reduce((a, b) => a + b, 0),
    recent_activity: recentActivity.results || [],
    pending_letters: upcoming.results || [],
  });
}

/* ================================ ROUTER ================================ */

const PUBLIC_PATHS = new Set(["/api/auth/login", "/api/auth/status", "/api/setup/init"]);

async function routeApi(request, env, path, user) {
  const method = request.method;
  const segs = path.split("/").filter(Boolean); // ["api", "clients", "3", ...]

  if (path === "/api/auth/status" && method === "GET") return authStatus(request, env);
  if (path === "/api/auth/login" && method === "POST") return authLogin(request, env);
  if (path === "/api/auth/logout" && method === "POST") return authLogout();
  if (path === "/api/auth/me" && method === "GET") return json({ user });
  if (path === "/api/auth/change-password" && method === "POST") return changePassword(request, env, user);
  if (path === "/api/auth/users" && method === "GET") return listUsers(env);
  if (path === "/api/auth/users" && method === "POST") return createUser(request, env, user);
  if (path === "/api/setup/init" && method === "POST") return setupInit(request, env);
  if (path === "/api/dashboard/stats" && method === "GET") return dashboardStats(env);

  if (segs[1] === "clients") {
    if (segs.length === 3 && segs[2] === "extract-id" && method === "POST") return clientExtractFromId(request, env, user);
    if (segs.length === 4 && segs[2] === "portal" && segs[3] === "backfill" && method === "POST") return clientPortalBackfill(env, user);
    if (segs.length === 5 && segs[3] === "portal" && segs[4] === "reset-password" && method === "POST") return clientPortalResetPassword(env, user, segs[2]);
    if (segs.length === 2 && method === "GET") return clientsList(request, env);
    if (segs.length === 2 && method === "POST") return clientCreate(request, env, user);
    if (segs.length === 3 && method === "GET") return clientGet(env, segs[2]);
    if (segs.length === 3 && method === "PUT") return clientUpdate(request, env, user, segs[2]);
    if (segs.length === 3 && method === "DELETE") return clientDelete(env, user, segs[2]);
    if (segs.length === 5 && segs[3] === "credit-report" && segs[4] === "import" && method === "POST") return creditReportImport(request, env, user, segs[2]);

    if (segs.length === 4 && segs[3] === "documents" && method === "GET") return clientDocumentsList(env, segs[2]);
    if (segs.length === 4 && segs[3] === "documents" && method === "POST") return clientDocumentUpload(request, env, user, segs[2]);
    if (segs.length === 5 && segs[3] === "documents" && method === "DELETE") return clientDocumentDelete(env, user, segs[2], segs[4]);
    if (segs.length === 6 && segs[3] === "documents" && segs[5] === "file" && method === "GET") return clientDocumentFile(env, segs[2], segs[4]);

    if (segs.length === 4 && segs[3] === "scores" && method === "GET") return creditScoresList(env, segs[2]);
    if (segs.length === 4 && segs[3] === "scores" && method === "POST") return creditScoreCreate(request, env, user, segs[2]);
    if (segs.length === 5 && segs[3] === "scores" && method === "DELETE") return creditScoreDelete(env, user, segs[2], segs[4]);

    if (segs.length === 4 && segs[3] === "addresses" && method === "GET") return clientAddressesList(env, segs[2]);
    if (segs.length === 4 && segs[3] === "addresses" && method === "POST") return clientAddressCreate(request, env, user, segs[2]);
    if (segs.length === 5 && segs[3] === "addresses" && method === "PUT") return clientAddressUpdate(request, env, user, segs[2], segs[4]);
    if (segs.length === 5 && segs[3] === "addresses" && method === "DELETE") return clientAddressDelete(env, user, segs[2], segs[4]);
  }

  if (segs[1] === "credit-items") {
    if (segs.length === 3 && segs[2] === "earnings" && method === "GET") {
      const url = new URL(request.url);
      return creditItemsEarnings(request, env, url.searchParams.get("client_id"));
    }
    if (segs.length === 3 && segs[2] === "earnings-by-client" && method === "GET") return creditItemsEarningsByClient(env);
    if (segs.length === 3 && segs[2] === "split-multibureau" && method === "POST") return creditItemsSplitMultiBureau(env, user);
    if (segs.length === 2 && method === "GET") return creditItemsList(request, env);
    if (segs.length === 2 && method === "POST") return creditItemCreate(request, env, user);
    if (segs.length === 3 && method === "PUT") return creditItemUpdate(request, env, user, segs[2]);
    if (segs.length === 3 && method === "DELETE") return creditItemDelete(env, user, segs[2]);
    if (segs.length === 4 && segs[3] === "billing-status" && method === "PUT") return creditItemSetBillingStatus(request, env, user, segs[2]);
  }

  if (segs[1] === "pricing") {
    if (segs.length === 2 && method === "GET") return pricingGet(env);
    if (segs.length === 2 && method === "PUT") return pricingUpdate(request, env, user);
  }

  if (segs[1] === "templates") {
    if (segs.length === 2 && method === "GET") return templatesList(env);
    if (segs.length === 2 && method === "POST") return templateCreate(request, env, user);
    if (segs.length === 3 && segs[2] === "seed" && method === "POST") return templatesSeed(env, user);
    if (segs.length === 3 && segs[2] === "import" && method === "POST") return templateImport(request, env, user);
    if (segs.length === 3 && method === "GET") return templateGet(env, segs[2]);
    if (segs.length === 3 && method === "PUT") return templateUpdate(request, env, user, segs[2]);
    if (segs.length === 3 && method === "DELETE") return templateDelete(env, user, segs[2]);
  }

  if (segs[1] === "letters") {
    if (segs.length === 2 && method === "GET") return lettersList(request, env);
    if (segs.length === 2 && method === "POST") return letterCreate(request, env, user);
    if (segs.length === 3 && method === "GET") return letterGet(env, segs[2]);
    if (segs.length === 3 && method === "PUT") return letterUpdate(request, env, user, segs[2]);
    if (segs.length === 3 && method === "DELETE") return letterDelete(env, user, segs[2]);
    if (segs.length === 4 && segs[3] === "status" && method === "POST") return letterSetStatus(request, env, user, segs[2]);
    if (segs.length === 4 && segs[3] === "send" && method === "POST") return letterSend(request, env, user, segs[2]);
  }

  if (segs[1] === "mailings") {
    if (segs.length === 2 && method === "GET") return mailingsList(request, env);
    if (segs.length === 2 && method === "DELETE") return mailingsDeleteAll(env, user);
    if (segs.length === 3 && segs[2] === "refresh-all" && method === "POST") return mailingsRefreshAll(env, user);
    if (segs.length === 3 && method === "PUT") return mailingUpdate(request, env, user, segs[2]);
    if (segs.length === 4 && segs[3] === "refresh" && method === "POST") return mailingRefresh(env, user, segs[2]);
  }

  return errorJson("Ruta no encontrada.", 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (!path.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS", "Access-Control-Allow-Headers": "Content-Type" } });
    }

    if (!env.SUPABASE_URL || !env.SUPABASE_SECRET_KEY) {
      return errorJson("Falta configurar SUPABASE_URL y/o SUPABASE_SECRET_KEY en este Worker de Cloudflare (Runtime variables and secrets).", 500);
    }
    env = { ...env, DB: createD1Shim(env) };

    // El portal del cliente vive en su propio espacio: usa su propia cookie/sesión, nunca la de
    // tu equipo (ver handlePortalRequest), así que se atiende aparte de PUBLIC_PATHS/routeApi.
    if (path.startsWith("/api/portal/")) {
      return handlePortalRequest(request, env, path);
    }

    let user = null;
    if (!PUBLIC_PATHS.has(path)) {
      if (!env.SESSION_SECRET) {
        return errorJson("Falta configurar la variable de entorno SESSION_SECRET en este Worker de Cloudflare.", 500);
      }
      const cookies = parseCookies(request);
      const payload = await verifyToken(cookies.session, env.SESSION_SECRET);
      if (!payload) return errorJson("No has iniciado sesión.", 401);
      user = payload;
    }

    try {
      return await routeApi(request, env, path, user);
    } catch (e) {
      console.error(e);
      return errorJson(`Error interno: ${e.message}`, 500);
    }
  },
};
