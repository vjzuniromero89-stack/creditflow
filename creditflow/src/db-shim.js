/* =====================================================================
   db-shim.js — Adaptador D1 -> Supabase/Postgres
   CreditFlow v6.1: añade retry/backoff para errores temporales de
   Supabase/PostgREST (429, 502, 503, 504) sin cambiar la API existente.
   ===================================================================== */

const DML_WITHOUT_RETURNING = /^\s*(INSERT|UPDATE|DELETE)\b(?![\s\S]*\bRETURNING\b)/i;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 350;

function needsReturning(sql) {
  return DML_WITHOUT_RETURNING.test(sql);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(attempt, resp) {
  const retryAfter = Number(resp?.headers?.get?.("retry-after"));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, 5000);
  }
  // 350ms, 700ms, 1400ms (+ pequeño jitter)
  return Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 120), 3000);
}

class D1ShimStatement {
  constructor(runner, sql) {
    this._runner = runner;
    this._sql = sql;
    this._params = [];
  }

  bind(...args) {
    this._params = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
    return this;
  }

  async _exec() {
    const sql = needsReturning(this._sql) ? `${this._sql} RETURNING *` : this._sql;
    return this._runner.execSql(sql, this._params);
  }

  async first(column) {
    const rows = await this._exec();
    if (!rows.length) return null;
    if (column) return rows[0][column] ?? null;
    return rows[0];
  }

  async all() {
    const rows = await this._exec();
    return { results: rows, success: true, meta: { rows_read: rows.length } };
  }

  async run() {
    const rows = await this._exec();
    const lastRow = rows.length ? rows[rows.length - 1] : null;
    return {
      success: true,
      results: rows,
      meta: {
        last_row_id: lastRow && "id" in lastRow ? lastRow.id : null,
        changes: rows.length,
        rows_written: rows.length,
      },
    };
  }

  async raw() {
    const rows = await this._exec();
    return rows.map((r) => Object.values(r));
  }
}

class SupabaseD1Shim {
  constructor({ supabaseUrl, supabaseKey }) {
    if (!supabaseUrl || !supabaseKey) {
      throw new Error("SupabaseD1Shim: faltan SUPABASE_URL o SUPABASE_SECRET_KEY.");
    }
    this._rpcUrl = `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/exec_sql`;
    this._apiKey = supabaseKey;
  }

  prepare(sql) {
    return new D1ShimStatement(this, sql);
  }

  async batch(statements) {
    const out = [];
    for (const stmt of statements) out.push(await stmt.run());
    return out;
  }

  async execSql(sql, params) {
    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let resp;

      try {
        resp = await fetch(this._rpcUrl, {
          method: "POST",
          headers: {
            apikey: this._apiKey,
            Authorization: `Bearer ${this._apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ query: sql, params: params ?? [] }),
        });
      } catch (err) {
        lastError = err;
        if (attempt < MAX_ATTEMPTS) {
          await sleep(retryDelay(attempt));
          continue;
        }
        throw new Error(
          `Supabase no respondió después de ${MAX_ATTEMPTS} intentos: ${err?.message || String(err)}`
        );
      }

      if (resp.ok) {
        const data = await resp.json();
        return Array.isArray(data) ? data : [];
      }

      const text = await resp.text().catch(() => "");
      lastError = new Error(
        `Supabase exec_sql falló (HTTP ${resp.status}): ${text.slice(0, 500)}`
      );

      if (RETRYABLE_STATUS.has(resp.status) && attempt < MAX_ATTEMPTS) {
        await sleep(retryDelay(attempt, resp));
        continue;
      }

      throw lastError;
    }

    throw lastError || new Error("Supabase exec_sql falló sin respuesta.");
  }
}

export function createD1Shim(env) {
  return new SupabaseD1Shim({
    supabaseUrl: env.SUPABASE_URL,
    supabaseKey: env.SUPABASE_SECRET_KEY,
  });
}
