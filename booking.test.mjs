import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createApp } from './server.mjs';
import { addDays, today } from './seed.mjs';

const password = 'test-runner-demo-only';
let root;
let server;
let origin;
let auth;
let scratch;
const future = addDays(today(), 14);
const dow = new Date(future + 'T00:00:00Z').getUTCDay();
const weekend = addDays(future, (6 - dow + 7) % 7);
const weekday = addDays(weekend, 2);

async function launch(file) {
  ({ server } = createApp({ database: file, password }));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  origin = 'http://127.0.0.1:' + server.address().port;
}
async function close() {
  const closed = once(server, 'close');
  server.close();
  await closed;
}
async function request(path, data, cookie, from) {
  const response = await fetch(origin + '/api/' + path, {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookie ? { Cookie: cookie } : {}), ...(from ? { Origin: from } : {}) },
    body: data === undefined ? undefined : JSON.stringify(data)
  });
  return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0] };
}
const player = (index = 0) => ({ name: 'Demo Player ' + index, mobile: '091700000' + String(index).padStart(2, '0') });
const slot = (court, start, rate = 400) => ({ court, start, rate });
const booking = (date, slots, index = 0, quantity = 0) => ({
  ...player(index), date, slots, quantity, equipmentRate: 80,
  total: slots.reduce((amount, item) => amount + item.rate, 0) + quantity * 80
});
const staff = (path, data) => request('staff/' + path, data, auth);

describe('Booking assessment acceptance checks', () => {
  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'mactan-booking-'));
    scratch = join(root, 'test.sqlite');
    await launch(scratch);
    const login = await request('staff/login', { username: 'staff', password });
    assert.equal(login.status, 200);
    auth = login.cookie;
  });
  after(async () => {
    if (server?.listening) await close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('serves the browser entry points and blue court asset', async () => {
    for (const asset of ['/', '/staff', '/app.js', '/staff.js', '/shared.js', '/style.css', '/court-hero.webp']) {
      const response = await fetch(origin + asset);
      assert.equal(response.status, 200, asset);
      assert.ok((await response.arrayBuffer()).byteLength > 100, asset);
    }
    const initial = await request('bootstrap');
    assert.equal(initial.data.courts.length, 4);
    const one = await request('sessions?date=' + initial.data.sessionDate);
    assert.equal(one.data.sessions.filter(item => item.type === 'Open Play').length, 3);
    assert.ok(one.data.sessions.some(item => item.type === 'Beginner Clinic'));
    assert.ok(one.data.sessions.some(item => item.type === 'Private Lesson' && item.capacity === 1));
  });

  it('persists a multi-court quote under one reference and retains it after rate changes', async () => {
    const original = booking(weekend, [slot(1, 600), slot(2, 660, 500)], 1, 1);
    const posted = await request('bookings', original);
    assert.equal(posted.status, 200);
    assert.equal(posted.data.total, 980);
    const lookup = { reference: posted.data.reference, mobile: original.mobile };
    assert.equal((await request('lookup', lookup)).data.status, 'Pending');
    const day = await staff('day?date=' + weekend);
    const id = day.data.bookings.find(item => item.reference === lookup.reference).id;
    assert.equal((await staff('booking', { id, action: 'confirm' })).data.status, 'Confirmed');
    assert.equal((await staff('settings', { kind: 'court', id: 1, mode: 'all', weekday: 400, weekend: 475 })).status, 200);
    const read = await request('lookup', lookup);
    assert.equal(read.data.status, 'Confirmed');
    assert.equal(read.data.total, 980);
    assert.equal(read.data.slots.length, 2);
    assert.equal((await staff('day?date=' + weekend)).data.reports.quotedValue, 980);
    assert.equal((await request('lookup', { ...lookup, mobile: player(2).mobile })).status, 404);
    assert.equal((await request('lookup', { ...lookup, reference: 'INVALID' })).status, 404);
    const repriced = await request('bookings', booking(weekend, [slot(1, 720)], 3));
    assert.equal(repriced.data.code, 'price');
    assert.equal(repriced.data.details.total, 475);
    assert.equal((await staff('day?date=' + weekend)).data.bookings.length, 1);
    assert.equal((await request('bookings', booking(weekend, [slot(1, 720, 475)], 3))).status, 200);
  });

  it('rejects competing and partial requests, then releases cancelled and declined hours', async () => {
    const date = addDays(weekday, 1);
    const proposals = [booking(date, [slot(1, 600)], 4), booking(date, [slot(1, 600)], 5)];
    const outcomes = await Promise.all(proposals.map(body => request('bookings', body)));
    assert.deepEqual(outcomes.map(item => item.status).sort(), [200, 409]);
    const eligible = booking(date, [slot(2, 600), slot(1, 600)], 8);
    assert.equal((await request('bookings', eligible)).status, 409);
    const day = await staff('day?date=' + date);
    assert.equal(day.data.bookings.length, 1);
    assert.equal(day.data.bookings[0].slots.length, 1);
    const id = day.data.bookings[0].id;
    assert.equal((await staff('booking', { id, action: 'decline', note: 'Court is closed for maintenance.' })).status, 200);
    assert.equal((await request('availability?date=' + date)).data.courts[0].slots[10].status, 'Available');
    assert.equal((await staff('manual', proposals[0])).status, 200);
    assert.equal((await staff('manual', proposals[1])).status, 409);
    const confirmed = (await staff('day?date=' + date)).data.bookings.find(item => item.status === 'Confirmed');
    assert.equal((await staff('booking', { id: confirmed.id, action: 'cancel' })).status, 200);
    assert.equal((await request('availability?date=' + date)).data.courts[0].slots[10].status, 'Available');
  });

  it('enforces the shared equipment stock without saving a failed booking', async () => {
    const date = addDays(weekday, 2);
    assert.equal((await request('bookings', booking(date, [slot(1, 600)], 6, 6))).status, 200);
    const unavailable = await request('bookings', booking(date, [slot(2, 600)], 7, 1));
    assert.equal(unavailable.status, 409);
    assert.equal(unavailable.data.code, 'stock');
    assert.equal((await request('availability?date=' + date)).data.courts[1].slots[10].status, 'Available');
  });

  it('fills a session, waits, releases and promotes while preventing active duplicates', async () => {
    const date = addDays(weekday, 3);
    const session = { date, court: 1, start: 600, end: 660, type: 'Open Play', title: 'One-spot demo', skill: 'Intermediate', fee: 250, capacity: 1 };
    const created = await staff('session', session);
    assert.equal(created.status, 200);
    const id = created.data.id;
    assert.equal((await staff('session', session)).status, 409);
    assert.equal((await staff('block', { ...session, reason: 'Maintenance' })).status, 409);
    const adjacent = await staff('block', { ...session, start: 660, end: 720, reason: 'Maintenance' });
    assert.equal(adjacent.status, 200);
    assert.equal((await staff('unblock', { id: adjacent.data.id })).status, 200);
    const results = await Promise.all([9, 10].map(index => request('registrations', { id, ...player(index), waitlist: true })));
    assert.deepEqual(results.map(item => item.data.status).sort(), ['Pending', 'Waitlisted']);
    assert.equal((await request('registrations', { id, ...player(9), waitlist: true })).data.code, 'duplicate');
    const roster = (await staff('day?date=' + date)).data.sessions[0].roster;
    const first = roster.find(item => item.status === 'Pending');
    const second = roster.find(item => item.status === 'Waitlisted');
    assert.equal((await staff('registration', { id: second.id, action: 'promote' })).status, 409);
    assert.equal((await staff('registration', { id: first.id, action: 'confirm' })).data.status, 'Confirmed');
    assert.equal((await staff('registration', { id: first.id, action: 'checkIn' })).data.status, 'Checked in');
    assert.equal((await staff('registration', { id: first.id, action: 'release' })).data.status, 'Released');
    assert.equal((await staff('registration', { id: second.id, action: 'promote' })).data.status, 'Confirmed');
    assert.equal((await request('lookup', { reference: second.reference, mobile: second.mobile })).data.status, 'Confirmed');
  });

  it('enforces single-player coaching, operating hours, and staff access', async () => {
    const date = addDays(weekday, 4);
    assert.equal((await request('staff/day?date=' + date)).status, 401);
    assert.equal((await request('staff/manual', booking(date, [slot(1, 660)]))).status, 401);
    assert.equal((await request('bookings', booking(date, [slot(1, 660)]), undefined, 'https://different.example')).status, 403);
    assert.equal((await staff('settings', { kind: 'court', id: 4, mode: 'custom', opens: 480, closes: 1080, weekday: 400, weekend: 500 })).status, 200);
    assert.equal((await request('availability?date=' + date)).data.courts[3].slots[7].status, 'Closed');
    const created = await staff('session', { date, start: 600, end: 660, court: 4, title: 'Private lesson', fee: 1000,
      skill: 'Beginner', capacity: 12, type: 'Private Lesson', coach: 'Coach Demo' });
    assert.equal(created.status, 200);
    const id = created.data.id;
    assert.equal((await request('registrations', { id, ...player(11) })).data.status, 'Pending');
    assert.equal((await request('registrations', { id, ...player(12) })).data.code, 'full');
    assert.equal((await request('bookings', booking(date, [slot(4, 600, 500)], 13))).status, 409);
    assert.ok((await request('availability?date=' + addDays(today(), -1))).data.courts.every(court => court.slots.every(item => item.status === 'Past')));
  });

  it('shows a decline reason, who declined, and the original time only to the right player', async () => {
    const date = addDays(weekday, 8);
    const form = booking(date, [slot(2, 780)], 15);
    const posted = await request('bookings', form);
    assert.equal(posted.status, 200);
    const { reference } = posted.data;
    const id = (await staff('day?date=' + date)).data.bookings.find(item => item.reference === reference).id;
    assert.equal((await staff('booking', { id, action: 'decline' })).status, 400);
    assert.equal((await request('lookup', { reference, mobile: form.mobile })).data.status, 'Pending');
    const note = 'Court maintenance after the storm.';
    assert.equal((await staff('booking', { id, action: 'decline', note })).status, 200);
    const declined = (await request('lookup', { reference, mobile: form.mobile })).data;
    assert.equal(declined.status, 'Declined');
    assert.equal(declined.date, date);
    assert.equal(declined.slots[0].start, 780);
    assert.deepEqual(declined.activity[0].previous, { date, slots: [{ court_id: 2, court: 'Court 2', start: 780 }] });
    assert.equal(declined.activity[0].actor, 'Staff');
    assert.equal(declined.activity[0].note, note);
    assert.ok(Number.isInteger(declined.activity[0].created));
    assert.equal((await request('lookup', { reference, mobile: player(20).mobile })).status, 404);
    assert.equal((await request('staff/history')).status, 401);
    const history = (await staff('history?date=' + today())).data.items;
    assert.ok(history.some(item => item.reference === reference && item.event === 'Booking declined' && item.note === note));
  });

  it('accepts, declines and counters proposals without moving bookings before both sides agree', async () => {
    const date = addDays(weekday, 9);
    const next = addDays(weekday, 10);
    const form = booking(date, [slot(1, 600), slot(2, 660)], 16);
    const posted = await request('bookings', form);
    assert.equal(posted.status, 200);
    const identity = { reference: posted.data.reference, mobile: form.mobile };
    const id = (await staff('day?date=' + date)).data.bookings.find(item => item.reference === identity.reference).id;
    await staff('booking', { id, action: 'confirm' });
    const draft = { date: next, slots: [slot(1, 720), slot(2, 780)] };
    const offered = await staff('reschedule', { ...draft, id, action: 'propose', note: 'Please choose the new time if it works for you.' });
    assert.equal(offered.status, 200);
    const proposal = offered.data.proposal;
    const entered = (await request('lookup', identity)).data;
    assert.equal(entered.date, date);
    assert.equal(entered.status, 'Confirmed');
    assert.equal(entered.proposal.actor, 'Staff');
    assert.equal(entered.proposal.proposed.date, next);
    assert.equal((await staff('reschedule', { id, action: 'accept', proposal })).status, 409);
    assert.equal((await request('reschedule', { ...identity, mobile: player(20).mobile, action: 'accept', proposal })).status, 404);
    assert.equal((await request('reschedule', { ...identity, action: 'decline', proposal, note: 'I cannot make that time.' })).status, 200);
    const retained = (await request('lookup', identity)).data;
    assert.equal(retained.status, 'Confirmed');
    assert.equal(retained.date, date);
    assert.equal(retained.proposal, null);
    assert.equal(retained.activity[0].note, 'I cannot make that time.');

    const another = (await staff('reschedule', { ...draft, id, action: 'propose' })).data.proposal;
    const counter = await request('reschedule', { ...identity, date: next, slots: [slot(3, 720), slot(2, 840)],
      proposal: another, action: 'propose', note: 'A later time works for me.' });
    assert.equal(counter.status, 200);
    const counterId = counter.data.proposal;
    assert.equal((await staff('reschedule', { id, action: 'accept', proposal: another })).data.code, 'proposal-changed');
    const occupied = await request('bookings', booking(next, [slot(3, 720, 450)], 17));
    assert.equal(occupied.status, 200);
    assert.equal((await staff('reschedule', { id, action: 'accept', proposal: counterId })).data.code, 'conflict');
    assert.equal((await request('lookup', identity)).data.date, date);
    const occupiedId = (await staff('day?date=' + next)).data.bookings.find(item => item.reference === occupied.data.reference).id;
    await staff('booking', { id: occupiedId, action: 'decline', note: 'Requested by player.' });
    assert.equal((await staff('reschedule', { id, action: 'accept', proposal: counterId })).status, 200);
    const moved = (await request('lookup', identity)).data;
    assert.equal(moved.reference, identity.reference);
    assert.equal(moved.date, next);
    assert.equal(moved.total, form.total);
    assert.equal(moved.activity[0].event, 'Booking rescheduled');
    assert.equal(moved.proposal, null);
    const released = (await request('availability?date=' + date)).data;
    assert.equal(released.courts[0].slots[10].status, 'Available');
    assert.equal(released.courts[1].slots[11].status, 'Available');
  });

  it('serves the install manifest, icons, and service worker without caching booking data', async () => {
    const response = await fetch(origin + '/manifest.webmanifest');
    assert.match(response.headers.get('content-type'), /application\/manifest\+json/);
    const manifest = await response.json();
    assert.equal(manifest.start_url, '/');
    assert.equal(manifest.display, 'standalone');
    for (const icon of manifest.icons) {
      const asset = await fetch(origin + icon.src);
      assert.equal(asset.status, 200);
      const png = Buffer.from(await asset.arrayBuffer());
      const [width, height] = icon.sizes.split('x').map(Number);
      assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [width, height]);
    }
    for (const path of ['/booking-updates.js', '/install.js', '/service-worker.js', '/offline.html']) {
      assert.equal((await fetch(origin + path)).status, 200);
    }
    const lookup = await fetch(origin + '/api/bootstrap');
    assert.equal(lookup.headers.get('cache-control'), 'no-store');
  });

  it('delivers private approval and reschedule alerts to the saved player browser', async () => {
    const date = addDays(weekday, 11);
    const next = addDays(weekday, 14);
    const form = booking(date, [slot(1, 600)], 21);
    const result = await request('bookings', form);
    assert.equal(result.status, 200);
    const { reference, watch } = result.data;
    const token = watch.token;
    assert.equal(watch.seen, 0);
    const forged = token.slice(0, -1) + (token.endsWith('a') ? 'b' : 'a');
    assert.deepEqual((await request('watch', { tokens: [token, forged] })).data.items, [{ reference, notice: null }]);
    assert.equal((await request('lookup', { reference, mobile: player(22).mobile })).status, 404);
    assert.equal((await request('lookup', { watchToken: forged })).status, 401);
    const day = await staff('day?date=' + date);
    assert.ok(day.data.courts.every(court => court.openHours.length === 24));
    const id = day.data.bookings.find(item => item.reference === reference).id;
    assert.equal((await staff('booking', { id, action: 'confirm' })).status, 200);
    const approved = (await request('watch', { tokens: [token] })).data.items[0].notice;
    assert.equal(approved.title, 'Booking approved');
    assert.equal(approved.tone, 'success');
    const lookedUp = (await request('lookup', { watchToken: token })).data;
    assert.equal(lookedUp.reference, reference);
    assert.equal(lookedUp.mobile, undefined);
    assert.equal(lookedUp.watch.seen, approved.id);
    const change = await staff('reschedule', { id, action: 'propose', date: next, slots: [slot(2, 720)], note: 'Court maintenance' });
    assert.equal(change.status, 200);
    const yellow = (await request('watch', { tokens: [token] })).data.items[0].notice;
    assert.equal(yellow.tone, 'pending');
    assert.equal(yellow.note, 'Court maintenance');
    assert.equal((await request('reschedule', { watchToken: forged, action: 'accept', proposal: change.data.proposal })).status, 401);
    assert.equal((await request('reschedule', { watchToken: token, action: 'accept', proposal: change.data.proposal })).status, 200);
    assert.equal((await request('watch', { tokens: [token] })).data.items[0].notice, null);
    assert.equal((await request('lookup', { watchToken: token })).data.date, next);
  });

  it('keeps player references across a server restart', async () => {
    const date = addDays(weekday, 7);
    const post = await request('bookings', booking(date, [slot(1, 900)], 14));
    assert.equal(post.status, 200);
    await close();
    await launch(scratch);
    assert.equal((await request('lookup', { reference: post.data.reference, mobile: player(14).mobile })).data.status, 'Pending');
    assert.equal((await request('lookup', { watchToken: post.data.watch.token })).data.reference, post.data.reference);
  });
});
