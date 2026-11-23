import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { addDays, today, zone } from './seed.mjs';

export class AppError extends Error {
  constructor(status, message, code, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}

const fail = (message, status = 400, code, details) => { throw new AppError(status, message, code, details); };
const text = (value, name, max = 100) => {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result || result.length > max) fail('Enter a valid ' + name + '.');
  return result;
};
const optionalNote = value => value == null || value === '' || (typeof value === 'string' && !value.trim()) ? '' : text(value, 'note', 500);
const number = (value, name, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max) fail('Enter a valid ' + name + '.');
  return value;
};
const choice = (value, values, name) => {
  if (!values.includes(value)) fail('Choose a valid ' + name + '.');
  return value;
};

export function dateValue(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('Choose a valid date.');
  const date = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== value) fail('Choose a valid date.');
  return value;
}

const manilaClock = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' });
const minuteNow = () => {
  const [hour, minute] = manilaClock.format(new Date()).split(':').map(Number);
  return hour * 60 + minute;
};
function cutoffFor(date) {
  const current = today();
  return date < current ? 1440 : date === current ? minuteNow() : -1;
}
const passed = (date, start) => start <= cutoffFor(date);
const overlap = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;
const hourRate = (court, date) => [0, 6].includes(new Date(date + 'T00:00:00Z').getUTCDay()) ? court.weekend : court.weekday;
const ref = () => randomBytes(8).toString('hex').toUpperCase();
const clock = minute => String(Math.floor(minute / 60)).padStart(2, '0') + ':' + String(minute % 60).padStart(2, '0');
const sessionTypes = ['Open Play', 'Beginner Clinic', 'Private Lesson'];
const skillLevels = ['Beginner', 'Intermediate', 'Advanced'];
const watchLifetime = 30 * 86400000;
const noticeTypes = new Map([
  ['Booking confirmed', ['success', 'Booking approved']],
  ['Booking declined', ['danger', 'Booking declined']],
  ['Booking cancelled', ['danger', 'Booking cancelled']],
  ['New time proposed', ['pending', 'New time proposed']],
  ['Booking rescheduled', ['success', 'New time approved']],
  ['Reschedule offer declined', ['pending', 'Change request declined']],
  ['Session request confirmed', ['success', 'Session spot approved']],
  ['Session request declined', ['danger', 'Session request declined']],
  ['Waitlisted player promoted', ['success', 'Session spot approved']]
]);

function phone(value) {
  const result = text(value, 'mobile number', 24).replace(/[\s()-]/g, '').replace(/^\+?63/, '0');
  if (!/^09\d{9}$/.test(result)) fail('Use a Philippine mobile number such as 09171234567.');
  return result;
}

function courtOpen(court, start, end) {
  return court.mode === 'all' || (court.mode === 'custom' && (
    court.opens < court.closes ? start >= court.opens && end <= court.closes : end <= court.closes || start >= court.opens
  ));
}

export function createStore(db, runTransaction) {
  const statements = new Map();
  function sql(query) {
    if (!statements.has(query)) statements.set(query, db.prepare(query));
    return statements.get(query);
  }

  function transaction(work) {
    if (runTransaction) return runTransaction(work);
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  const venue = () => sql('SELECT name,location,contact FROM venue').get();
  const courts = () => sql('SELECT * FROM courts ORDER BY id').all();
  const equipment = () => sql('SELECT name,stock,rate FROM equipment').get();

  function courtById(id) {
    const court = sql('SELECT * FROM courts WHERE id = ?').get(number(id, 'court', 1, 999));
    if (!court) fail('That court could not be found.', 404);
    return court;
  }

  function schedule(date) {
    return sql(
      "SELECT s.court_id,s.start,s.start+60 AS end,'booking' AS kind,b.status,b.reference AS label,b.id " +
      "FROM booking_slots s JOIN bookings b ON b.id=s.booking_id WHERE b.date=? AND b.status IN ('Pending','Confirmed') " +
      "UNION ALL SELECT court_id,start,end,'session','Session',title,id FROM sessions WHERE date=? " +
      "UNION ALL SELECT court_id,start,end,'block','Blocked',reason,id FROM blocks WHERE date=? " +
      "ORDER BY court_id,start"
    ).all(date, date, date);
  }

  function bookingSlots(id) {
    return sql('SELECT s.court_id,c.name AS court,s.start,s.rate FROM booking_slots s JOIN courts c ON c.id=s.court_id WHERE s.booking_id=? ORDER BY s.court_id,s.start').all(id);
  }

  function logActivity(reference, event, actor, note = '', previous = null, proposed = null) {
    sql('INSERT INTO booking_activity (reference,event,actor,note,created,previous,proposed) VALUES (?,?,?,?,?,?,?)')
      .run(reference, event, actor, note, Date.now(), previous ? JSON.stringify(previous) : null, proposed ? JSON.stringify(proposed) : null);
  }

  const activityView = row => ({
    ...row, previous: row.previous ? JSON.parse(row.previous) : null, proposed: row.proposed ? JSON.parse(row.proposed) : null
  });
  function activityFor(reference) {
    return sql('SELECT id,event,actor,note,created,previous,proposed FROM booking_activity WHERE reference=? ORDER BY id DESC LIMIT 20')
      .all(reference).map(activityView);
  }

  let watchKey;
  function signWatch(value) {
    watchKey ??= sql('SELECT watch_key FROM app_secrets WHERE id=1').get().watch_key;
    return createHmac('sha256', Buffer.from(watchKey, 'hex')).update('booking-watch:' + value).digest();
  }

  function watchReference(token) {
    if (typeof token !== 'string') return null;
    const match = /^([A-F0-9]{16})\.(\d{5,6})\.([a-f0-9]{64})$/.exec(token);
    if (!match || Number(match[2]) * 86400000 <= Date.now()) return null;
    const [, reference, day, signature] = match;
    return timingSafeEqual(signWatch(reference + '.' + day), Buffer.from(signature, 'hex')) ? reference : null;
  }

  function latestNotice(reference) {
    const event = sql('SELECT id,event,actor,note,created FROM booking_activity WHERE reference=? ORDER BY id DESC LIMIT 1').get(reference);
    if (event?.actor !== 'Staff' || !noticeTypes.has(event.event)) return null;
    const [tone, title] = noticeTypes.get(event.event);
    return { id: event.id, tone, title, note: event.note, created: event.created };
  }

  function watchBooking(reference) {
    const day = Math.floor((Date.now() + watchLifetime) / 86400000);
    const value = reference + '.' + day;
    return { reference, token: value + '.' + signWatch(value).toString('hex'), expires: day * 86400000, seen: latestNotice(reference)?.id ?? 0 };
  }

  function pollWatch(tokens) {
    if (!Array.isArray(tokens) || tokens.length > 12) fail('Check up to 12 saved bookings at a time.');
    const references = [...new Set(tokens.map(watchReference).filter(Boolean))];
    return { items: references.map(reference => ({ reference, notice: latestNotice(reference) })) };
  }

  function bookingContact(body) {
    if (body.watchToken === undefined) return {
      reference: text(body.reference, 'reference', 24).toUpperCase(), mobile: phone(body.mobile)
    };
    const reference = watchReference(body.watchToken);
    if (!reference) fail('This saved booking link expired. Check your reference and mobile number again.', 401, 'watch-expired');
    return { reference, mobile: null };
  }

  function privateBooking(contact) {
    return sql('SELECT * FROM bookings WHERE reference=? AND (mobile=? OR ? IS NULL)')
      .get(contact.reference, contact.mobile, contact.mobile);
  }

  const scheduleView = (date, slots) => ({
    date, slots: slots.map(slot => ({ court_id: slot.court_id, court: slot.court, start: slot.start }))
  });

  function pendingProposal(id) {
    return sql("SELECT * FROM reschedule_proposals WHERE booking_id=? AND status='Pending'").get(id);
  }

  function proposalView(proposal) {
    return proposal ? {
      id: proposal.id, actor: proposal.actor, note: proposal.note, created: proposal.created,
      proposed: { date: proposal.date, slots: JSON.parse(proposal.slots) }
    } : null;
  }

  function canMove(booking, slots) {
    return ['Pending', 'Confirmed'].includes(booking.status) && slots.length > 0 && slots.every(slot => !passed(booking.date, slot.start));
  }

  function publicDay(date) {
    dateValue(date);
    const busy = schedule(date);
    const cutoff = cutoffFor(date);
    return {
      date,
      today: today(),
      venue: venue(),
      equipment: equipment(),
      courts: courts().map(court => ({
        id: court.id, name: court.name, rate: hourRate(court, date),
        slots: Array.from({ length: 24 }, (_, hour) => {
          const start = hour * 60;
          const hold = busy.find(item => item.court_id === court.id && overlap(start, start + 60, item.start, item.end));
          let status = 'Available';
          if (start <= cutoff) status = 'Past';
          else if (hold) status = { Pending: 'Pending', Confirmed: 'Booked', Session: 'Booked', Blocked: 'Closed' }[hold.status];
          else if (!courtOpen(court, start, start + 60)) status = 'Closed';
          return { start, status };
        })
      }))
    };
  }

  function requireSlot(court, start, end, busy, cutoff) {
    const label = court.name + ' at ' + clock(start);
    if (start <= cutoff) fail(label + ' has already started.', 409, 'conflict');
    if (!courtOpen(court, start, end)) fail(label + ' is outside operating hours.', 409, 'conflict');
    if (busy.some(item => item.court_id === court.id && overlap(start, end, item.start, item.end))) {
      fail(label + ' is no longer available. Choose another time.', 409, 'conflict');
    }
  }

  function availableSlots(date, items, ownId = 0) {
    const busy = schedule(date).filter(item => item.kind !== 'booking' || item.id !== ownId);
    const cutoff = cutoffFor(date);
    const seen = new Set();
    return items.map(item => {
      const court = courtById(item?.court);
      const start = number(item?.start, 'slot start', 0, 1380);
      const key = court.id + ':' + start;
      if (start % 60 || seen.has(key)) fail('Choose distinct one-hour slots.');
      seen.add(key);
      requireSlot(court, start, start + 60, busy, cutoff);
      return { court: court.id, name: court.name, start, rate: hourRate(court, date) };
    });
  }

  function requireEquipment(date, slots, quantity, stock, ownId = 0) {
    if (!quantity) return;
    const rentals = sql(
      "SELECT DISTINCT b.id,b.quantity,s.start FROM bookings b JOIN booking_slots s ON s.booking_id=b.id " +
      "WHERE b.date=? AND b.status IN ('Pending','Confirmed') AND b.quantity>0 AND b.id<>?"
    ).all(date, ownId);
    const used = Math.max(...slots.map(slot => rentals.filter(item => item.start === slot.start)
      .reduce((sum, item) => sum + item.quantity, 0)));
    if (quantity + used > stock) fail('There are only ' + Math.max(0, stock - used) + ' paddles available across those hours.', 409, 'stock');
  }

  const writeSlots = (id, slots) => {
    for (const slot of slots) sql('INSERT INTO booking_slots VALUES (?,?,?,?)').run(id, slot.court, slot.start, slot.rate);
  };

  function saveBooking(body, manual = false) {
    const date = dateValue(body.date);
    const name = text(body.name, 'player name');
    const mobile = phone(body.mobile);
    const quantity = number(body.quantity ?? 0, 'equipment quantity', 0, 999);
    if (!Array.isArray(body.slots) || body.slots.length < 1 || body.slots.length > 96) fail('Select at least one court hour.');
    return transaction(() => {
      const gear = equipment();
      const slots = availableSlots(date, body.slots);
      requireEquipment(date, slots, quantity, gear.stock);
      const total = slots.reduce((sum, slot) => sum + slot.rate, 0) + quantity * gear.rate;
      const quote = { slots, equipmentRate: gear.rate, quantity, total };
      if (!manual && (body.total !== total || (quantity > 0 && body.equipmentRate !== gear.rate)
          || slots.some((slot, index) => body.slots[index].rate !== slot.rate))) {
        fail('The quote changed. Review the updated amounts, then submit again.', 409, 'price', quote);
      }
      const status = manual ? 'Confirmed' : 'Pending';
      const reference = ref();
      const booking = sql('INSERT INTO bookings (reference,name,mobile,date,status,quantity,equipment_rate,total,created) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id')
        .get(reference, name, mobile, date, status, quantity, gear.rate, total, Date.now());
      writeSlots(booking.id, slots);
      logActivity(reference, manual ? 'Manual booking confirmed' : 'Booking requested', manual ? 'Staff' : 'Player',
        '', scheduleView(date, bookingSlots(booking.id)));
      return { reference, date, status, ...quote };
    });
  }

  function findBooking(body) {
    const contact = bookingContact(body);
    const { reference, mobile } = contact;
    const booking = privateBooking(contact);
    if (booking) {
      const { id, date, status, quantity, equipment_rate, total } = booking;
      const slots = bookingSlots(id);
      return {
        kind: 'Court booking', reference, date, status, quantity, equipment_rate, total, slots, canReschedule: canMove(booking, slots),
        proposal: proposalView(pendingProposal(id)), activity: activityFor(reference)
      };
    }
    const registration = sql(
      'SELECT r.reference,r.status,s.title,s.date,s.start,s.end,s.fee,c.name AS court FROM registrations r ' +
      'JOIN sessions s ON s.id=r.session_id JOIN courts c ON c.id=s.court_id WHERE r.reference=? AND (r.mobile=? OR ? IS NULL)'
    ).get(reference, mobile, mobile);
    if (registration) return { kind: 'Session request', ...registration, activity: activityFor(reference) };
    fail('No request matches that reference and mobile number.', 404);
  }

  function reschedule(body, actor) {
    const action = choice(body.action, ['propose', 'accept', 'decline'], 'reschedule action');
    const note = optionalNote(body.note);
    return transaction(() => {
      const booking = actor === 'Staff'
        ? sql('SELECT * FROM bookings WHERE id=?').get(number(body.id, 'booking', 1, 1e9))
        : privateBooking(bookingContact(body));
      if (!booking) fail('No matching booking. Check the booking details and try again.', 404);
      const original = bookingSlots(booking.id);
      const previous = scheduleView(booking.date, original);
      const pending = pendingProposal(booking.id);
      if ((body.proposal ?? null) !== (pending?.id ?? null)) {
        fail('This proposal changed. Refresh the booking and try again.', 409, 'proposal-changed');
      }

      if (action === 'propose') {
        if (!canMove(booking, original)) fail('Only upcoming pending or confirmed bookings can be moved.', 409);
        const date = dateValue(body.date);
        if (!Array.isArray(body.slots) || body.slots.length !== original.length) fail('Choose the same number of court hours as the original booking.');
        const slots = availableSlots(date, body.slots, booking.id).sort((a, b) => a.court - b.court || a.start - b.start);
        if (date === booking.date && slots.every((slot, i) => slot.court === original[i].court_id && slot.start === original[i].start)) {
          fail('Choose a different date, court or time.');
        }
        requireEquipment(date, slots, booking.quantity, equipment().stock, booking.id);
        const proposed = scheduleView(date, slots.map(slot => ({ court_id: slot.court, court: slot.name, start: slot.start })));
        if (pending) sql("UPDATE reschedule_proposals SET status='Superseded' WHERE id=?").run(pending.id);
        const stored = sql("INSERT INTO reschedule_proposals (booking_id,actor,status,note,date,slots,created) VALUES (?,?,'Pending',?,?,?,?) RETURNING id")
          .get(booking.id, actor, note, date, JSON.stringify(proposed.slots), Date.now());
        logActivity(booking.reference, actor === 'Staff' ? 'New time proposed' : 'Change requested', actor, note, previous, proposed);
        return { proposal: stored.id, status: booking.status };
      }

      if (!pending || pending.actor === actor) fail('Only the other side can respond to this proposal.', 409);
      const proposed = proposalView(pending).proposed;
      if (action === 'decline') {
        sql("UPDATE reschedule_proposals SET status='Declined' WHERE id=?").run(pending.id);
        logActivity(booking.reference, 'Reschedule offer declined', actor, note, previous, proposed);
        return { status: booking.status };
      }

      if (!canMove(booking, original)) fail('This booking can no longer be moved.', 409);
      const slots = availableSlots(proposed.date, proposed.slots.map(slot => ({ court: slot.court_id, start: slot.start })), booking.id);
      requireEquipment(proposed.date, slots, booking.quantity, equipment().stock, booking.id);
      sql('DELETE FROM booking_slots WHERE booking_id=?').run(booking.id);
      writeSlots(booking.id, slots.map((slot, index) => ({ ...slot, rate: original[index].rate })));
      sql("UPDATE bookings SET date=?,status='Confirmed' WHERE id=?").run(proposed.date, booking.id);
      sql("UPDATE reschedule_proposals SET status='Accepted' WHERE id=?").run(pending.id);
      logActivity(booking.reference, 'Booking rescheduled', actor, note, previous, proposed);
      return { status: 'Confirmed', date: proposed.date };
    });
  }

  function sessionList(date) {
    dateValue(date);
    return sql(
      "SELECT s.*,c.name AS court,s.capacity-(SELECT COUNT(*) FROM registrations r WHERE r.session_id=s.id " +
      "AND r.status IN ('Pending','Confirmed','Checked in')) AS remaining FROM sessions s JOIN courts c ON c.id=s.court_id " +
      "WHERE s.date=? ORDER BY s.start,s.id"
    ).all(date);
  }

  function sessionById(id) {
    const session = sql('SELECT * FROM sessions WHERE id=?').get(number(id, 'session', 1, 1_000_000_000));
    if (!session) fail('That session could not be found.', 404);
    return session;
  }

  const capacityUsed = id => sql(
    "SELECT COUNT(*) AS used FROM registrations WHERE session_id=? AND status IN ('Pending','Confirmed','Checked in')"
  ).get(id).used;

  function joinSession(body) {
    const name = text(body.name, 'player name');
    const mobile = phone(body.mobile);
    return transaction(() => {
      const session = sessionById(body.id);
      if (passed(session.date, session.start)) fail('This session has already begun.', 409, 'conflict');
      if (sql("SELECT 1 FROM registrations WHERE session_id=? AND mobile=? AND status IN ('Pending','Confirmed','Checked in','Waitlisted')").get(session.id, mobile)) {
        fail('This mobile number already has a request for the session.', 409, 'duplicate');
      }
      const status = capacityUsed(session.id) < session.capacity ? 'Pending' : 'Waitlisted';
      if (status === 'Waitlisted' && body.waitlist !== true) {
        fail('That session just filled up. Review the waitlist option and try again.', 409, 'full');
      }
      const reference = ref();
      sql('INSERT INTO registrations (reference,session_id,name,mobile,status) VALUES (?,?,?,?,?)')
        .run(reference, session.id, name, mobile, status);
      logActivity(reference, status === 'Waitlisted' ? 'Joined session waitlist' : 'Session spot requested', 'Player', '',
        { date: session.date, slots: [{ court: courtById(session.court_id).name, start: session.start, end: session.end }] });
      return { status, reference, title: session.title, date: session.date, start: session.start, end: session.end };
    });
  }

  function staffDay(date) {
    dateValue(date);
    const bookings = sql('SELECT * FROM bookings WHERE date=? ORDER BY created DESC').all(date)
      .map(booking => {
        const slots = bookingSlots(booking.id);
        const proposal = ['Pending', 'Confirmed'].includes(booking.status) ? proposalView(pendingProposal(booking.id)) : null;
        return { ...booking, slots, canReschedule: canMove(booking, slots), proposal };
      });
    return {
      date, venue: venue(), courts: courts().map(court => ({
        ...court, openHours: Array.from({ length: 24 }, (_, hour) => courtOpen(court, hour * 60, (hour + 1) * 60))
      })), schedule: schedule(date), bookings,
      sessions: sessionList(date).map(session => ({
        ...session, roster: sql('SELECT * FROM registrations WHERE session_id=? ORDER BY id').all(session.id)
      })),
      reports: {
        counts: Object.fromEntries(['Pending', 'Confirmed', 'Declined', 'Cancelled'].map(status => [status, bookings.filter(item => item.status === status).length])),
        quotedValue: bookings.filter(item => item.status === 'Confirmed').reduce((sum, item) => sum + item.total, 0)
      }
    };
  }

  function bookingAction(body) {
    const transition = { confirm: ['Pending', 'Confirmed'], decline: ['Pending', 'Declined'], cancel: ['Confirmed', 'Cancelled'] };
    const [from, to] = transition[choice(body.action, Object.keys(transition), 'booking action')];
    const note = body.action === 'decline' ? text(body.note, 'decline reason', 500) : optionalNote(body.note);
    return transaction(() => {
      const id = number(body.id, 'booking', 1, 1e9);
      const booking = sql('UPDATE bookings SET status=? WHERE id=? AND status=? RETURNING reference,date').get(to, id, from);
      if (!booking) fail('That booking has already changed. Refresh the dashboard.', 409);
      sql("UPDATE reschedule_proposals SET status='Superseded' WHERE booking_id=? AND status='Pending'").run(id);
      logActivity(booking.reference, 'Booking ' + to.toLowerCase(), 'Staff', note, scheduleView(booking.date, bookingSlots(id)));
      return { status: to };
    });
  }

  function registrationAction(body) {
    const transition = {
      confirm: [['Pending'], 'Confirmed'], decline: [['Pending', 'Waitlisted'], 'Declined'],
      checkIn: [['Confirmed'], 'Checked in'], release: [['Pending', 'Confirmed', 'Checked in'], 'Released'],
      promote: [['Waitlisted'], 'Confirmed']
    };
    const [allowed, to] = transition[choice(body.action, Object.keys(transition), 'roster action')];
    const note = body.action === 'decline' ? text(body.note, 'decline reason', 500) : optionalNote(body.note);
    return transaction(() => {
      const item = sql('SELECT * FROM registrations WHERE id=?').get(number(body.id, 'registration', 1, 1e9));
      if (!item || !allowed.includes(item.status)) fail('That registration has already changed.', 409);
      const session = sessionById(item.session_id);
      if (body.action === 'promote') {
        if (passed(session.date, session.start)) fail('This session has already begun.', 409);
        if (capacityUsed(session.id) >= session.capacity) fail('Release a spot before promoting a player.', 409);
      }
      sql('UPDATE registrations SET status=? WHERE id=?').run(to, item.id);
      const event = body.action === 'promote' ? 'Waitlisted player promoted' : 'Session request ' + to.toLowerCase();
      logActivity(item.reference, event, 'Staff', note,
        { date: session.date, slots: [{ court: courtById(session.court_id).name, start: session.start, end: session.end }] });
      return { status: to };
    });
  }

  function holdCourt(body, kind) {
    const date = dateValue(body.date);
    const start = number(body.start, 'start time', 0, 1439);
    const end = number(body.end, 'end time', start + 1, 1440);
    return transaction(() => {
      const court = courtById(body.court);
      requireSlot(court, start, end, schedule(date), cutoffFor(date));
      if (kind === 'block') {
        const reason = text(body.reason, 'reason', 150);
        return sql('INSERT INTO blocks (date,court_id,start,end,reason) VALUES (?,?,?,?,?) RETURNING id').get(date, court.id, start, end, reason);
      }
      const type = choice(body.type, sessionTypes, 'session type');
      const title = text(body.title, 'session title');
      const skill = choice(body.skill, skillLevels, 'skill level');
      const fee = number(body.fee, 'fee', 0, 100000);
      const capacity = type === 'Private Lesson' ? 1 : number(body.capacity, 'capacity', 1, 250);
      const coach = type === 'Open Play' ? '' : text(body.coach, 'coach name');
      return sql('INSERT INTO sessions (date,type,title,court_id,start,end,skill,fee,capacity,coach) VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id')
        .get(date, type, title, court.id, start, end, skill, fee, capacity, coach);
    });
  }

  function settings(body) {
    if (body.kind === 'venue') {
      sql('UPDATE venue SET name=?,location=?,contact=? WHERE id=1')
        .run(text(body.name, 'venue name'), text(body.location, 'location'), text(body.contact, 'contact details', 180));
      return venue();
    }
    const court = courtById(body.id);
    const mode = choice(body.mode, ['all', 'custom', 'closed'], 'court hours option');
    const opens = mode === 'custom' ? number(body.opens, 'opening time', 0, 1439) : court.opens;
    const closes = mode === 'custom' ? number(body.closes, 'closing time', 1, 1440) : court.closes;
    if (mode === 'custom' && opens === closes) fail('Choose different opening and closing times.');
    sql('UPDATE courts SET mode=?,opens=?,closes=?,weekday=?,weekend=? WHERE id=?')
      .run(mode, opens, closes, number(body.weekday, 'weekday price', 0, 100000), number(body.weekend, 'weekend price', 0, 100000), court.id);
    return { id: court.id };
  }

  return {
    today, venue, courts, dateValue, publicDay, saveBooking, findBooking, watchBooking, pollWatch, joinSession, staffDay, bookingAction, reschedule, registrationAction, holdCourt, settings,
    history(date) {
      dateValue(date);
      const start = Date.parse(date + 'T00:00:00+08:00');
      return {
        date, items: sql('SELECT * FROM booking_activity WHERE created>=? AND created<? ORDER BY created DESC,id DESC LIMIT 100')
          .all(start, start + 86400000).map(activityView)
      };
    },
    sessions(date) {
      dateValue(date);
      const cutoff = cutoffFor(date);
      return sessionList(date).filter(item => item.start > cutoff);
    },
    initialSessionDate() {
      const now = today();
      const next = sql('SELECT date FROM sessions WHERE date>=? AND date<=? AND (date>? OR start>?) ORDER BY date,start LIMIT 1')
        .get(now, addDays(now, 30), now, minuteNow());
      return next?.date ?? now;
    },
    removeBlock(body) {
      if (!sql('DELETE FROM blocks WHERE id=?').run(number(body.id, 'court block', 1, 1e9)).changes) fail('That court block was already removed.', 404);
      return { removed: true };
    }
  };
}
