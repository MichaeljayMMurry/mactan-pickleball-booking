import { DurableObject } from 'cloudflare:workers';
import { createHash, timingSafeEqual } from 'node:crypto';
import schema from './schema.sql';
import { seedDemo, seedWatchKey } from './seed.mjs';
import { createStore } from './store.mjs';
import { createApi, securityHeaders } from './api.mjs';

function storageAdapter(sql) {
  return {
    exec(query) { sql.exec(query).toArray(); },
    prepare(query) {
      return {
        all: (...bindings) => sql.exec(query, ...bindings).toArray(),
        get: (...bindings) => sql.exec(query, ...bindings).toArray()[0],
        run(...bindings) {
          const cursor = sql.exec(query, ...bindings);
          cursor.toArray();
          return { changes: cursor.rowsWritten };
        }
      };
    }
  };
}

const digest = value => createHash('sha256').update(value).digest();

export class ClubDatabase extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    const db = storageAdapter(ctx.storage.sql);
    const transaction = work => ctx.storage.transactionSync(work);
    ctx.blockConcurrencyWhile(async () => {
      if ((ctx.storage.kv.get('schema-version') ?? 0) < 3) {
        transaction(() => {
          // Foreign keys are always enabled by the Durable Objects SQL backend.
          db.exec(schema.replace(/^PRAGMA foreign_keys = ON;\s*/, ''));
          seedDemo(db);
          seedWatchKey(db);
          ctx.storage.kv.put('schema-version', 3);
        });
      }
    });
    const hasSecret = typeof env.STAFF_PASSWORD === 'string' && env.STAFF_PASSWORD.length >= 16;
    const passwordHash = hasSecret ? digest(env.STAFF_PASSWORD) : null;
    const username = env.STAFF_USERNAME || 'staff';
    this.handle = createApi(db, createStore(db, transaction), {
      secure: true,
      verifyStaff: (user, password) => !!passwordHash && timingSafeEqual(digest(password), passwordHash) && user === username
    });
  }

  fetch(request) {
    return this.handle(request, request.headers.get('CF-Connecting-IP') ?? '');
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return env.CLUB.getByName('mactan-venue').fetch(request);
    }
    if (url.pathname === '/' || url.pathname === '/staff') url.pathname = '/index.html';
    const result = await env.ASSETS.fetch(new Request(url, request));
    const headers = new Headers(result.headers);
    for (const [name, value] of Object.entries(securityHeaders)) headers.set(name, value);
    if (url.pathname === '/service-worker.js') headers.set('Cache-Control', 'no-cache');
    return new Response(result.body, { status: result.status, statusText: result.statusText, headers });
  }
};

