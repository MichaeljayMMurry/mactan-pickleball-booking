import { createHash, randomBytes } from 'node:crypto';
import { AppError } from './store.mjs';

export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'self'; img-src 'self'; script-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
};
const digest = value => createHash('sha256').update(value).digest('hex');
const lifetime = 8 * 60 * 60;

function json(status, body, headers = {}) {
  return Response.json(body, { status, headers: { ...securityHeaders, 'Cache-Control': 'no-store', ...headers } });
}

async function readBody(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    throw new AppError(415, 'Send a JSON request.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AppError(400, 'The request is incomplete.');
  const decoder = new TextDecoder();
  let bytes = 0;
  let content = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 24_000) {
        reader.cancel().catch(() => {});
        throw new AppError(413, 'The request is too large.');
      }
      content += decoder.decode(value, { stream: true });
    }
    const parsed = JSON.parse(content + decoder.decode());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(400, 'The request is incomplete.');
  } finally {
    reader.releaseLock();
  }
}

export function createApi(db, store, { verifyStaff, secure = false, publicOrigin } = {}) {
  const limits = new Map();
  const cookie = (token, ttl) => 'mpc_staff=' + token + '; Path=/; HttpOnly; SameSite=Strict; Max-Age=' + ttl + (secure ? '; Secure' : '');
  const tokenHash = request => {
    const token = request.headers.get('cookie')?.match(/(?:^|;\s*)mpc_staff=([a-f0-9]{64})(?:;|$)/)?.[1];
    return token ? digest(token) : '';
  };
  const findStaff = db.prepare('SELECT 1 FROM staff_sessions WHERE token_hash=? AND expires>?');
  const pruneStaff = db.prepare('DELETE FROM staff_sessions WHERE expires<=? OR token_hash=?');
  const insertStaff = db.prepare('INSERT INTO staff_sessions VALUES (?,?)');
  const endStaff = db.prepare('DELETE FROM staff_sessions WHERE token_hash=?');
  const track = result => ({ ...result, watch: store.watchBooking(result.reference) });
  const writes = new Map([
    ['/api/bookings', body => track(store.saveBooking(body))],
    ['/api/lookup', body => track(store.findBooking(body))],
    ['/api/watch', body => store.pollWatch(body.tokens)],
    ['/api/reschedule', body => store.reschedule(body, 'Player')],
    ['/api/registrations', body => track(store.joinSession(body))],
    ['/api/staff/booking', body => store.bookingAction(body)],
    ['/api/staff/reschedule', body => store.reschedule(body, 'Staff')],
    ['/api/staff/manual', body => store.saveBooking(body, true)],
    ['/api/staff/session', body => store.holdCourt(body, 'session')],
    ['/api/staff/registration', body => store.registrationAction(body)],
    ['/api/staff/block', body => store.holdCourt(body, 'block')],
    ['/api/staff/unblock', body => store.removeBlock(body)],
    ['/api/staff/settings', body => store.settings(body)]
  ]);

  function limit(client, group, maximum) {
    const now = Date.now();
    const key = group + ':' + client;
    if (limits.size >= 500) {
      for (const [entry, value] of limits) if (value.until <= now) limits.delete(entry);
      if (limits.size >= 500 && !limits.has(key)) throw new AppError(429, 'The app is busy. Try again in a minute.');
    }
    const current = limits.get(key);
    const bucket = !current || current.until <= now ? { until: now + 60_000, used: 0 } : current;
    if (++bucket.used > maximum) throw new AppError(429, 'Too many attempts. Try again in a minute.');
    limits.set(key, bucket);
  }

  return async function handle(request, client = '') {
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const isPost = request.method === 'POST';
      if (isPost) {
        const origin = request.headers.get('origin');
        if (origin && origin !== (publicOrigin ?? url.origin)) throw new AppError(403, 'This request must come from the booking website.');
      }

      if (path === '/api/staff/login' && isPost) {
        limit(client, 'login', 12);
        const { username, password } = await readBody(request);
        if (typeof username !== 'string' || username.length > 100 || typeof password !== 'string' || password.length > 256
          || !await verifyStaff(username, password)) throw new AppError(401, 'The username or password is incorrect.');
        const token = randomBytes(32).toString('hex');
        pruneStaff.run(Date.now(), tokenHash(request));
        insertStaff.run(digest(token), Date.now() + lifetime * 1000);
        return json(200, { signedIn: true }, { 'Set-Cookie': cookie(token, lifetime) });
      }

      const staffRoute = path.startsWith('/api/staff/');
      if (staffRoute && !findStaff.get(tokenHash(request), Date.now())) throw new AppError(401, 'Sign in as staff to continue.');
      if (path === '/api/staff/logout' && isPost) {
        endStaff.run(tokenHash(request));
        return json(200, { signedIn: false }, { 'Set-Cookie': cookie('', 0) });
      }

      if (request.method === 'GET') {
        const date = url.searchParams.get('date') ?? store.today();
        if (path === '/api/bootstrap') return json(200, { ...store.publicDay(date), sessionDate: store.initialSessionDate() });
        if (path === '/api/availability') return json(200, store.publicDay(date));
        if (path === '/api/sessions') return json(200, { sessions: store.sessions(date) });
        if (path === '/api/staff/day') return json(200, store.staffDay(date));
        if (path === '/api/staff/history') return json(200, store.history(date));
      }
      if (isPost && writes.has(path)) {
        if (path === '/api/lookup' || path === '/api/reschedule') limit(client, 'lookup', 30);
        if (path === '/api/watch') limit(client, 'watch', 60);
        if (path === '/api/bookings' || path === '/api/registrations') limit(client, 'player-write', 45);
        const body = await readBody(request);
        if (staffRoute && !findStaff.get(tokenHash(request), Date.now())) throw new AppError(401, 'Sign in as staff to continue.');
        return json(200, writes.get(path)(body));
      }
      return json(404, { error: 'This action could not be found.' });
    } catch (error) {
      if (error instanceof AppError) return json(error.status, { error: error.message, code: error.code, details: error.details });
      console.error(error);
      return json(500, { error: 'The server could not complete that action. Please try again.' });
    }
  };
}

