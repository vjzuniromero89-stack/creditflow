// CreditFlow v11.7.2 — Audit save 500 hotfix
// The v11 wrapper stack is intentionally bypassed for the v9 assessment route.
// This avoids exhausting Cloudflare subrequests when saving one audit.
import v117Worker from "./index-v11-7.js";
import v9Worker from "./index-v9.js";

export default {
  async fetch(request, env, ctx) {
    const u = new URL(request.url);
    const method = request.method.toUpperCase();

    // v9 owns the professional dispute assessment CRUD.
    // Route it directly to v9 instead of:
    // v11.7 -> v11.4 -> v11.3 -> v11.2 -> ... -> v9
    // This preserves v9 validation and database logic while cutting wrapper overhead.
    if (
      method === "PUT" &&
      /^\/api\/strategy\/client\/\d+\/items\/\d+\/assessment$/.test(u.pathname)
    ) {
      try {
        return await v9Worker.fetch(request, env, ctx);
      } catch (e) {
        return new Response(JSON.stringify({
          error: "No se pudo guardar la auditoría.",
          detail: String(e?.message || e),
          code: "AUDIT_SAVE_FAILED"
        }), {
          status: 500,
          headers: {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store"
          }
        });
      }
    }

    return v117Worker.fetch(request, env, ctx);
  }
};
