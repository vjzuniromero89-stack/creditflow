/* =====================================================================
   db-shim.js — Adaptador que hace que Supabase (Postgres) se vea como
   el binding `env.DB` de Cloudflare D1 (SQLite) que usa el resto del
   backend (`env.DB.prepare(sql).bind(...args).first()/.all()/.run()`).

   Por qué existe: CreditFlow se migró de D1 a Supabase para que la
   base de datos quede en la misma cuenta de Supabase que los demás
   proyectos de Karen (junto a GitHub, Cloudflare y Netlify). En vez de
   reescribir las ~176 llamadas a env.DB.prepare(...) repartidas por
   todo index.js, este archivo implementa la misma API que D1 por
   encima de una función RPC de Postgres (`exec_sql`), así el resto
   del código no cambia.

   Cómo funciona: cada llamada `.bind(...args).first()/.all()/.run()`
   termina llamando a la RPC `exec_sql(query text, params jsonb)` en
   Supabase, que sustituye cada "?" de la query (estilo D1/SQLite) por
   su valor ya escapado con quote_nullable (nunca concatenación
   cruda), y devuelve las filas resultantes como jsonb. Para
   INSERT/UPDATE/DELETE, este shim agrega automáticamente
   "RETURNING *" si la query no la trae, porque Postgres lo exige para
   poder leer las filas afectadas (y así calcular meta.last_row_id).
   ===================================================================== */

const DML_WITHOUT_RETURNING = /^\s*(INSERT|UPDATE|DELETE)\b(?![\s\S]*\bRETURNING\b)/i;

function needsReturning(sql) {
  return DML_WITHOUT_RETURNING.test(sql);
}

class D1ShimStatement {
  constructor(runner, sql) {
    this._runner = runner;
    this._sql = sql;
    this._params = [];
  }

  bind(...args) {
    // D1 aplana bind(a, b, c); soportamos también bind([a, b, c]) por si acaso.
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

  // Poco usado en el backend actual, pero D1 lo expone: ejecuta y descarta el resultado.
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

  // Para paridad con D1 (poco usado en este backend).
  async batch(statements) {
    const out = [];
    for (const stmt of statements) out.push(await stmt.run());
    return out;
  }

  async execSql(sql, params) {
    const resp = await fetch(this._rpcUrl, {
      method: "POST",
      headers: {
        apikey: this._apiKey,
        Authorization: `Bearer ${this._apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ query: sql, params: params ?? [] }),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Supabase exec_sql falló (HTTP ${resp.status}): ${text.slice(0, 500)}`);
    }
    const data = await resp.json();
    // La RPC devuelve directamente el jsonb array de filas.
    return Array.isArray(data) ? data : [];
  }
}

export function createD1Shim(env) {
  return new SupabaseD1Shim({
    supabaseUrl: env.SUPABASE_URL,
    supabaseKey: env.SUPABASE_SECRET_KEY,
  });
}
