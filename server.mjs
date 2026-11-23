import { createServer } from 'node:http';
import { scrypt, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { promisify } from 'node:util';
import { createStore } from './store.mjs';
import { createApi, securityHeaders } from './api.mjs';
import { seedDemo, seedStaff, seedWatchKey } from './seed.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const hashPassword = promisify(scrypt);
const staticFiles = new Map([
  ['/', 'index.html'], ['/staff', 'index.html'], ['/style.css', 'style.css'],
  ['/app.js', 'app.js'], ['/staff.js', 'staff.js'], ['/shared.js', 'shared.js'],
  ['/court-hero.webp', 'court-hero.webp'], ['/mark.svg', 'mark.svg'],
  ...['booking-updates.js', 'booking-alerts.js', 'manifest.webmanifest', 'service-worker.js', 'install.js', 'offline.html',
    'app-192.png', 'app-512.png', 'app-maskable.png'].map(asset => ['/' + asset, asset])
]);
const types = { '.html': 'text/html; charset=UTF-8', '.css': 'text/css; charset=UTF-8',
  '.js': 'text/javascript; charset=UTF-8', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json; charset=UTF-8' };

export function createApp(options = {}) {
  const filename = options.database ?? resolve(root, 'data', 'club.sqlite');
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;');
  db.exec(readFileSync(resolve(root, 'schema.sql'), 'utf8'));
  db.exec('BEGIN IMMEDIATE');
  const username = options.username ?? 'staff';
  let generatedPassword;
  try {
    seedDemo(db);
    seedWatchKey(db);
    generatedPassword = seedStaff(db, username, options.password);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  const store = createStore(db);
  const api = createApi(db, store, {
    secure: options.secure,
    publicOrigin: options.publicOrigin,
    async verifyStaff(enteredUser, password) {
      const staff = db.prepare('SELECT * FROM staff').get();
      const calculated = await hashPassword(password, staff.salt, 64);
      return timingSafeEqual(calculated, Buffer.from(staff.password_hash, 'hex')) && enteredUser === staff.username;
    }
  });

  const server = createServer(async (request, response) => {
    try {
      const base = (options.secure ? 'https://' : 'http://') + (request.headers.host || 'localhost');
      const url = new URL(request.url, base);
      const path = url.pathname;
      const isGet = request.method === 'GET';
      if (staticFiles.has(path) && (isGet || request.method === 'HEAD')) {
        const asset = staticFiles.get(path);
        const data = readFileSync(resolve(root, 'public', asset));
        response.writeHead(200, {
          ...securityHeaders, 'Content-Type': types[extname(asset)], 'Content-Length': data.length,
          'Cache-Control': asset.endsWith('.webp') ? 'public, max-age=3600' : 'no-cache'
        });
        return response.end(isGet ? data : undefined);
      }
      if (!path.startsWith('/api/')) {
        response.writeHead(404, { ...securityHeaders, 'Content-Type': 'text/plain' });
        return response.end('Page not found.');
      }
      const hasBody = !['GET', 'HEAD'].includes(request.method);
      const input = new Request(url, {
        method: request.method, headers: request.headers,
        ...(hasBody ? { body: Readable.toWeb(request), duplex: 'half' } : {})
      });
      const result = await api(input, request.socket.remoteAddress);
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      console.error(error);
      if (!response.headersSent) response.writeHead(500, { ...securityHeaders, 'Content-Type': 'text/plain; charset=UTF-8' });
      response.end('The server could not complete that request.');
    }
  });
  server.on('close', () => db.close());
  return { server, generatedPassword, username };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server, generatedPassword, username } = createApp({
    database: process.env.DATABASE_PATH ? resolve(process.env.DATABASE_PATH) : undefined,
    username: process.env.STAFF_USERNAME,
    password: process.env.STAFF_PASSWORD,
    secure: process.env.SECURE_COOKIE === '1',
    publicOrigin: process.env.PUBLIC_ORIGIN
  });
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? 3000);
  server.listen(port, host, () => {
    console.log('Local booking app: http://' + host + ':' + server.address().port);
    console.log('Staff username: ' + username);
    if (generatedPassword) console.log('First-run staff password (save it): ' + generatedPassword);
  });
}

