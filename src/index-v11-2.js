// CreditFlow v11.2 — PostGrid secret/runtime hotfix
// Keeps v11 intact and fixes env propagation through the wrapper chain.
import v11Worker from "./index-v11.js";
import { createD1Shim } from "./db-shim.js";

export default {
  async fetch(request, env, ctx) {
    // IMPORTANT:
    // Cloudflare Secrets are properties on the real env object.
    // Do not spread env into a new object; non-enumerable/runtime bindings can be lost.
    // Only attach DB shim if DB is not already available.
    const runtimeEnv = env;
    if (!runtimeEnv.DB || typeof runtimeEnv.DB.prepare !== "function") {
      runtimeEnv.DB = createD1Shim(env);
    }

    const url = new URL(request.url);

    // Diagnostic endpoint: authenticated handling remains in v11 for actual API calls.
    // This endpoint never exposes the secret value.
    if (url.pathname === "/api/postgrid/runtime-check" && request.method === "GET") {
      return new Response(JSON.stringify({
        ok: true,
        postgrid_test_key_present: typeof env.POSTGRID_TEST_API_KEY === "string" && env.POSTGRID_TEST_API_KEY.trim().length > 0,
        postgrid_test_key_length: typeof env.POSTGRID_TEST_API_KEY === "string" ? env.POSTGRID_TEST_API_KEY.length : 0,
        environment: "test",
        live_enabled: false
      }), {
        headers: {"content-type":"application/json; charset=utf-8"}
      });
    }

    return v11Worker.fetch(request, runtimeEnv, ctx);
  }
};
