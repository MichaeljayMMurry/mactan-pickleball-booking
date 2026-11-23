import { $, api, badge, dialog, escape, fieldValues, fillVenue, formMessage, longDate, pesos, playerFields, range, showReceipt } from './shared.js';
import { mountBookingUpdates } from './booking-updates.js';
import { mountBookingAlerts } from './booking-alerts.js';

const main = $('#main');
const periods = [
  ['Overnight', 0, 360], ['Morning', 360, 720], ['Afternoon', 720, 1080], ['Evening', 1080, 1440]
];
const tabs = [['book', 'Book a court'], ['open', 'Open Play'], ['coaching', 'Coaching']];
const state = {
  tab: 'book', date: '', today: '', gear: null, day: null, court: 1,
  selected: new Map(), quantity: 0, name: '', mobile: '', message: '', success: false,
  sessionDate: '', skill: '', sessions: [], submission: false, dayRequest: 0, sessionRequest: 0
};
const slotKey = (court, start) => court + ':' + start;
const formFeedback = '<p class="form-message" role="status"></p>';
let bookingAlerts;
const reviewVisibility = new IntersectionObserver(([entry]) => {
  const shortcut = $('.mobile-review');
  if (shortcut) shortcut.hidden = entry.isIntersecting;
}, { rootMargin: '0px 0px -56px' });

async function start() {
  if (location.pathname === '/staff') {
    $('#staff-link').setAttribute('aria-current', 'page');
    const { startStaff } = await import('./staff.js');
    return startStaff(main);
  }
  $('#player-link').setAttribute('aria-current', 'page');
  const data = await api('bootstrap');
  fillVenue(data.venue);
  Object.assign(state, { day: data, date: data.date, today: data.today, gear: data.equipment, sessionDate: data.sessionDate, court: data.courts[0]?.id });
  main.innerHTML = `<section class="hero">
    <div class="shell hero-inner"><div class="hero-content">
      <span class="eyebrow"><span class="hero-line"></span> ${escape(data.venue.location)}</span>
      <h1>Book your<br><span>next game.</span></h1>
      <p>Reserve a private court, join Open Play, or train with a coach.</p>
      <a class="primary hero-cta" href="#booking-workspace">Find a court</a>
    </div></div>
  </section>
  <section class="shell workspace" id="booking-workspace" aria-label="Player booking">
    <nav class="flow-nav" aria-label="Booking options">
      <div class="flow-links">${tabs.map(([id, name]) => `<button type="button" data-tab="${id}">${name}</button>`).join('')}</div>
      <button class="secondary lookup-button" type="button" data-lookup aria-controls="booking-updates" aria-expanded="false">Check booking status</button>
    </nav>
    <aside class="panel booking-updates" id="booking-updates" aria-labelledby="booking-updates-title" hidden></aside>
    <div id="workflow"></div>
  </section><section class="booking-alerts" aria-label="Booking notifications"></section>
  <p id="booking-alert-announcer" class="visually-hidden" role="status" aria-live="polite"></p>`;
  bookingAlerts = mountBookingAlerts($('.booking-alerts'), $('#booking-alert-announcer'), token => updates.show(token));
  const updates = mountBookingUpdates($('#booking-updates'), $('[data-lookup]'), state.today, bookingAlerts);
  main.addEventListener('click', onClick);
  main.addEventListener('change', onChange);
  main.addEventListener('input', event => {
    if (event.target.matches('#booking-form [name=name], #booking-form [name=mobile]')) {
      state[event.target.name] = event.target.value;
    }
  });
  main.addEventListener('submit', event => {
    if (event.target.id === 'booking-form') {
      event.preventDefault();
      submitBooking(event.target);
    }
  });
  render();
}

function selectedSlots() {
  return [...state.selected.values()].sort((a, b) => a.court - b.court || a.start - b.start);
}

function render(focus) {
  for (const button of main.querySelectorAll('[data-tab]')) {
    button.setAttribute('aria-current', button.dataset.tab === state.tab ? 'true' : 'false');
  }
  $('#workflow').innerHTML = state.tab === 'book' ? bookingMarkup() : sessionMarkup();
  reviewVisibility.disconnect();
  if ($('.mobile-review')) reviewVisibility.observe($('#review'));
  if (focus) focus.split(', ').map(selector => $(selector)).find(Boolean)?.focus({ preventScroll: true });
}

function bookingMarkup() {
  const court = state.day.courts.find(item => item.id === state.court);
  const weekend = [0, 6].includes(new Date(state.date + 'T00:00:00Z').getUTCDay());
  const counts = selectedSlots().reduce((map, slot) => map.set(slot.court, (map.get(slot.court) ?? 0) + 1), new Map());
  return `<div class="booking-grid">
    <section class="schedule-column" aria-label="Court availability">
      <div class="panel selection-panel">
        <div class="panel-heading date-heading">
          <div><h2>Find court time</h2><p>Choose a date, a court, and one-hour slots.</p></div>
          <label class="date-field">Booking date<input id="booking-date" type="date" min="${state.today}" value="${state.date}" required></label>
        </div>
        <div class="court-grid" aria-label="Courts">${state.day.courts.map(item => `<button class="court-card lift" data-court="${item.id}" type="button" aria-pressed="${item.id === state.court}">
          <strong>${escape(item.name)}</strong><span>${pesos(item.rate)} / hour</span>${counts.get(item.id) ? `<small>${counts.get(item.id)} selected</small>` : ''}
        </button>`).join('')}</div>
      </div>
      <div class="panel time-panel">
        <div class="panel-heading time-heading">
          <div><h2>${escape(court.name)} schedule</h2><p>${longDate(state.date)} · Cebu time</p></div>
          <span class="rate-label">${weekend ? 'Weekend rates' : 'Weekday rates'}</span>
        </div>
        ${state.loadingDay ? '<p class="empty" role="status">Loading court availability…</p>' : periods.map(([name, from, to]) => {
          const slots = court.slots.filter(slot => slot.start >= from && slot.start < to);
          return `<section class="period"><header><h3>${name}</h3><span>${range(from, to)}</span></header>
            <div class="slot-grid">${slots.map(slot => slotMarkup(court, slot)).join('')}</div></section>`;
        }).join('')}
      </div>
    </section>
    ${reviewMarkup()}
    ${state.selected.size ? `<a class="primary mobile-review" href="#review">Review booking · ${pesos(quote().total)}</a>` : ''}
  </div>`;
}

function slotMarkup(court, slot) {
  const key = slotKey(court.id, slot.start);
  const selected = state.selected.has(key);
  const status = selected && slot.status === 'Available' ? 'Selected' : slot.status;
  return `<button type="button" class="slot lift ${selected ? 'is-selected' : ''}" data-slot="${slot.start}" aria-pressed="${selected}" ${slot.status !== 'Available' ? 'disabled' : ''}>
    <span class="slot-mark" aria-hidden="true">${selected ? '✓' : '●'}</span>
    <strong>${range(slot.start, slot.start + 60)}</strong><span class="slot-status">${status}</span></button>`;
}

function quote() {
  const slots = selectedSlots();
  const courtCharges = slots.reduce((sum, slot) => sum + slot.rate, 0);
  const equipmentCharges = state.quantity * state.gear.rate;
  return { slots, courtCharges, equipmentCharges, total: courtCharges + equipmentCharges };
}

function reviewMarkup() {
  const { slots, total, courtCharges, equipmentCharges } = quote();
  return `<aside class="panel review-panel" id="review" tabindex="-1" aria-label="Review booking">
    <div class="panel-heading"><div><h2>Review booking</h2><p>${slots.length ? slots.length + ' court-hour' + (slots.length === 1 ? '' : 's') + ' selected' : 'No court hours selected'}</p></div></div>
    ${slots.length ? `<ul class="review-list">${slots.map(slot => `<li>
      <div><strong>${escape(slot.name)}</strong><small>${range(slot.start, slot.start + 60)}</small></div>
      <strong>${pesos(slot.rate)}</strong><button type="button" class="icon-button" data-remove="${slotKey(slot.court, slot.start)}" aria-label="Remove ${escape(slot.name)} at ${range(slot.start, slot.start + 60)}">×</button>
    </li>`).join('')}</ul>` : '<p class="empty compact">Choose an available hour to start your booking.</p>'}
    <div class="gear"><div><strong>${escape(state.gear.name)}</strong><small>${pesos(state.gear.rate)} each · up to ${state.gear.stock}</small></div><div class="stepper">
      <button type="button" class="icon-button" data-gear="-1" aria-label="Remove a paddle" ${state.quantity === 0 || state.submission ? 'disabled' : ''}>−</button>
      <output aria-label="Paddle quantity">${state.quantity}</output>
      <button type="button" class="icon-button" data-gear="1" aria-label="Add a paddle" ${!slots.length || state.quantity >= state.gear.stock || state.submission ? 'disabled' : ''}>+</button>
    </div></div>
    ${slots.length ? `<dl class="quote-breakdown"><div><dt>Court charges</dt><dd>${pesos(courtCharges)}</dd></div><div><dt>Rental charges</dt><dd>${pesos(equipmentCharges)}</dd></div></dl>` : ''}
    <div class="grand-total"><span>Grand total</span><strong>${pesos(total)}</strong></div>
    <form id="booking-form" class="stack">
      ${playerFields()}
      <p class="form-message ${state.message && !state.success ? 'error' : ''}" role="status">${escape(state.message)}</p>
      <button type="submit" class="primary full" ${!slots.length || state.submission || state.loadingDay ? 'disabled' : ''}>${state.submission ? 'Sending request…' : 'Request booking'}</button>
    </form>
  </aside>`;
}

function sessionMarkup() {
  const open = state.tab === 'open';
  const sessions = state.sessions.filter(session => (session.type === 'Open Play') === open && (!open || !state.skill || session.skill === state.skill));
  const skills = ['', 'Beginner', 'Intermediate', 'Advanced'];
  return `<section class="panel sessions-panel">
    <header class="panel-heading sessions-heading"><div><h2>${open ? 'Open Play' : 'Coaching'}</h2>
      <p>${open ? 'Find a group session at your skill level.' : 'Build your game with a coach.'}</p></div>
      <div class="filters"><label>Date<input id="session-date" type="date" min="${state.today}" value="${state.sessionDate}" required></label>
      ${open ? `<label>Skill level<select id="session-skill">${skills.map(skill => `<option value="${skill}" ${skill === state.skill ? 'selected' : ''}>${skill || 'All levels'}</option>`).join('')}</select></label>` : ''}</div>
    </header>
    ${state.loadingSessions ? '<p class="empty" role="status">Loading sessions…</p>' :
      state.sessionError ? `<p class="empty error" role="status">${escape(state.sessionError)} <button class="secondary" type="button" data-refresh-sessions>Try again</button></p>` :
      sessions.length ? `<div class="session-grid">${sessions.map(session => `<article class="session-card lift">
        <div class="session-top"><span class="rate-label">${escape(session.type)}</span><span class="session-spots">${session.remaining} ${session.remaining === 1 ? 'spot' : 'spots'} left</span></div>
        <h3>${escape(session.title)}</h3><p>${escape(session.court)} · ${range(session.start, session.end)}</p>
        <p>${escape(session.skill)}${session.coach ? ' · ' + escape(session.coach) : ''}</p>
        <footer><strong>${pesos(session.fee)} <small>/ player</small></strong><button type="button" class="${session.remaining ? 'primary' : 'secondary'}" data-join="${session.id}">
          ${session.remaining ? 'Request spot' : 'Join waitlist'}</button></footer></article>`).join('')}</div>` :
        '<p class="empty" role="status">No sessions match these filters. Try another date or skill level.</p>'}
  </section>`;
}

function updateReviewFields() {
  const form = $('#booking-form');
  if (form) {
    form.elements.name.value = state.name;
    form.elements.mobile.value = state.mobile;
  }
}

const renderWithFields = focus => { render(focus); updateReviewFields(); };

async function loadDay(date, switching = false) {
  const sequence = ++state.dayRequest;
  state.loadingDay = true;
  if (switching) state.message = '';
  renderWithFields();
  try {
    const result = await api('availability?date=' + encodeURIComponent(date));
    if (sequence !== state.dayRequest) return;
    if (switching && state.selected.size) {
      state.selected.clear();
      state.quantity = 0;
      state.message = 'Date changed. Your previous selections were cleared.';
      state.success = true;
    }
    state.day = result;
    state.date = date;
    state.today = result.today;
    state.gear = result.equipment;
    for (const [key, selected] of state.selected) {
      const currentCourt = result.courts.find(item => item.id === selected.court);
      if (currentCourt.slots.find(item => item.start === selected.start)?.status !== 'Available') state.selected.delete(key);
      else state.selected.set(key, { ...selected, rate: currentCourt.rate });
    }
    if (!state.selected.size) state.quantity = 0;
  } catch (error) {
    if (sequence !== state.dayRequest) return;
    state.message = error.message;
    state.success = false;
  } finally {
    if (sequence === state.dayRequest) {
      state.loadingDay = false;
      renderWithFields(switching ? '#booking-date' : undefined);
    }
  }
}

async function loadSessions(focus) {
  const sequence = ++state.sessionRequest;
  state.loadingSessions = true;
  state.sessionError = '';
  renderWithFields(focus);
  try {
    const result = await api('sessions?date=' + encodeURIComponent(state.sessionDate));
    if (sequence === state.sessionRequest) state.sessions = result.sessions;
  } catch (error) {
    if (sequence === state.sessionRequest) state.sessionError = error.message;
  } finally {
    if (sequence === state.sessionRequest) {
      state.loadingSessions = false;
      renderWithFields(focus);
    }
  }
}

function onClick(event) {
  const button = event.target.closest('button');
  if (!button) return;
  const { tab, court, slot, remove, gear, join } = button.dataset;
  if (state.submission) return;
  if (tab && tab !== state.tab) {
    state.tab = tab;
    if (tab !== 'book') loadSessions('[data-tab="' + tab + '"]');
    else renderWithFields('[data-tab="book"]');
  } else if (court) {
    state.court = Number(court);
    renderWithFields('[data-court="' + court + '"]');
  } else if (slot) {
    const selectedCourt = state.day.courts.find(item => item.id === state.court);
    const start = Number(slot);
    const key = slotKey(selectedCourt.id, start);
    if (state.selected.has(key)) state.selected.delete(key);
    else state.selected.set(key, { court: selectedCourt.id, name: selectedCourt.name, start, rate: selectedCourt.rate });
    if (!state.selected.size) state.quantity = 0;
    state.message = '';
    renderWithFields('[data-slot="' + slot + '"]');
  } else if (remove) {
    state.selected.delete(remove);
    if (!state.selected.size) state.quantity = 0;
    renderWithFields('.review-list [data-remove], [data-slot]:not([disabled])');
  } else if (gear) {
    state.quantity = Math.max(0, Math.min(state.gear.stock, state.quantity + Number(gear)));
    renderWithFields('[data-gear="' + gear + '"]:not([disabled]), [data-gear]:not([disabled])');
  } else if (join) {
    const session = state.sessions.find(item => item.id === Number(join));
    if (session) openSession(session);
  } else if ('refreshSessions' in button.dataset) {
    loadSessions();
  }
}

function onChange(event) {
  if (event.target.id === 'booking-date' && event.target.validity.valid && event.target.value !== state.date) {
    loadDay(event.target.value, true);
  } else if (event.target.id === 'session-date' && event.target.validity.valid) {
    state.sessionDate = event.target.value;
    loadSessions('#session-date');
  } else if (event.target.id === 'session-skill') {
    state.skill = event.target.value;
    renderWithFields('#session-skill');
  }
}

async function submitBooking(form) {
  if (state.submission || !state.selected.size) return;
  const values = fieldValues(form);
  const { slots, total } = quote();
  const payload = { ...values, slots, total, quantity: state.quantity, equipmentRate: state.gear.rate, date: state.date };
  state.submission = true;
  state.message = '';
  renderWithFields();
  try {
    const result = await api('bookings', payload);
    bookingAlerts.remember(result.watch);
    state.selected.clear();
    state.quantity = 0;
    state.name = '';
    state.mobile = '';
    await loadDay(state.date);
    showReceipt(result, 'Request received');
  } catch (error) {
    state.success = false;
    state.message = error.message;
    if (error.code === 'price') {
      const updated = error.details;
      state.gear.rate = updated.equipmentRate;
      for (const slot of updated.slots) {
        state.selected.set(slotKey(slot.court, slot.start), slot);
        const court = state.day.courts.find(item => item.id === slot.court);
        if (court) court.rate = slot.rate;
      }
    } else if (error.code === 'conflict') {
      await loadDay(state.date);
    }
  } finally {
    state.submission = false;
    renderWithFields(state.message ? '#booking-form .primary:not([disabled])' : undefined);
  }
}

function openSession(session) {
  const waitlist = session.remaining <= 0;
  const element = dialog(waitlist ? 'Join waitlist' : 'Request a spot', `<form class="stack" id="join-form">
    <p><strong>${escape(session.title)}</strong><br>${longDate(session.date)} · ${range(session.start, session.end)}</p>
    ${waitlist ? '<p>This session is full. Staff can offer you a spot if one opens.</p>' : ''}
    ${playerFields()}${formFeedback}<button class="primary" type="submit">${waitlist ? 'Join waitlist' : 'Request spot'}</button></form>`);
  $('#join-form', element).onsubmit = async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = $('button', form);
    button.disabled = true;
    const allowWaitlist = button.dataset.waitlist === 'true' || waitlist;
    try {
      const result = await api('registrations', { ...fieldValues(form), id: session.id, waitlist: allowWaitlist });
      bookingAlerts.remember(result.watch);
      showReceipt(result, 'Session request received');
      loadSessions();
    } catch (error) {
      formMessage(form, error.message);
      if (error.code === 'full') {
        button.dataset.waitlist = 'true';
        button.textContent = 'Join waitlist';
      }
    } finally {
      button.disabled = false;
    }
  };
}

start().catch(error => {
  main.innerHTML = `<section class="shell page-message" role="alert"><h1>Could not load the app</h1><p>${escape(error.message)}</p><a class="primary" href="${location.pathname === '/staff' ? '/staff' : '/'}">Try again</a></section>`;
});
