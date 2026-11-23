import { $, api, badge, escape, fieldValues, formMessage, longDate, pesos, range } from './shared.js';

const updateClock = new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit'
});
export const updateTime = timestamp => updateClock.format(new Date(timestamp)) + ' Cebu time';

export function scheduleSummary(schedule, label = '') {
  return `<div class="schedule-summary">${label ? `<strong>${escape(label)}</strong>` : ''}
    <span>${longDate(schedule.date)}</span>
    <ul>${schedule.slots.map(slot => `<li>${escape(slot.court)} · ${range(slot.start, slot.end ?? slot.start + 60)}</li>`).join('')}</ul>
  </div>`;
}

export function scheduleEditor(booking, today, buttonLabel) {
  return `<form class="stack schedule-editor">
    <p>Choose ${booking.slots.length} court-hour${booking.slots.length === 1 ? '' : 's'} on one date. Times are in Cebu. The booking keeps its original total.</p>
    <label>New date<input name="date" type="date" min="${today}" value="${booking.date < today ? today : booking.date}" required></label>
    <div class="slot-picker"><label>Available court time<select name="slot" disabled></select></label><button type="button" class="secondary" data-add-slot disabled>Add time</button></div>
    <ul class="schedule-draft" aria-label="Selected times"></ul>
    <label>Message (optional)<textarea name="note" maxlength="500" rows="2"></textarea></label>
    <p class="form-message" role="status"></p>
    <div class="actions"><button class="primary" type="submit" disabled>${escape(buttonLabel)}</button><button type="button" class="secondary" data-cancel-editor>Go back</button></div>
  </form>`;
}

export function bindScheduleEditor(form, booking, onSave, onCancel) {
  const { date, slot } = form.elements;
  const add = $('[data-add-slot]', form);
  const submit = $('[type="submit"]', form);
  const draft = $('.schedule-draft', form);
  const selected = new Map();
  let options = new Map();
  let search = 0;
  let busy = false;

  function render() {
    const remaining = [...options].filter(([key]) => !selected.has(key));
    slot.innerHTML = remaining.length ? remaining.map(([key, item]) =>
      `<option value="${key}">${escape(item.name)} · ${range(item.start, item.start + 60)}</option>`).join('') : '<option>No available hours</option>';
    slot.disabled = busy || !remaining.length;
    add.disabled = slot.disabled || selected.size >= booking.slots.length;
    submit.disabled = busy || selected.size !== booking.slots.length;
    draft.innerHTML = [...selected].map(([key, item]) => `<li>${escape(item.name)} · ${range(item.start, item.start + 60)}
      <button type="button" class="secondary small" data-remove-time="${key}" aria-label="Remove ${escape(item.name)} at ${range(item.start, item.start + 60)}">Remove</button></li>`).join('');
  }

  async function loadHours() {
    const request = ++search;
    options.clear();
    selected.clear();
    render();
    if (!date.validity.valid) return;
    formMessage(form, 'Loading available hours…', false);
    try {
      const day = await api('availability?date=' + encodeURIComponent(date.value));
      if (request !== search) return;
      for (const court of day.courts) {
        for (const hour of court.slots) {
          const belongsToBooking = day.date === booking.date && ['Booked', 'Pending'].includes(hour.status)
            && booking.slots.some(item => item.court_id === court.id && item.start === hour.start);
          if (hour.status === 'Available' || belongsToBooking) {
            options.set(court.id + ':' + hour.start, { court: court.id, name: court.name, start: hour.start });
          }
        }
      }
      formMessage(form, options.size ? '' : 'No available hours on this date. Choose another date.', false);
    } catch (error) {
      if (request === search) formMessage(form, error.message);
    } finally {
      if (request === search) render();
    }
  }

  date.onchange = loadHours;
  add.onclick = () => {
    const item = options.get(slot.value);
    if (item && selected.size < booking.slots.length) selected.set(slot.value, item);
    render();
    (add.disabled ? submit : slot).focus();
  };
  draft.onclick = event => {
    const button = event.target.closest('[data-remove-time]');
    if (!button || busy) return;
    selected.delete(button.dataset.removeTime);
    render();
    slot.focus();
  };
  $('[data-cancel-editor]', form).onclick = () => { if (!busy) onCancel(); };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy || selected.size !== booking.slots.length) return;
    busy = true;
    date.disabled = true;
    render();
    formMessage(form, 'Sending…', false);
    try {
      await onSave({ date: date.value, slots: [...selected.values()].map(({ court, start }) => ({ court, start })), note: form.elements.note.value });
    } catch (error) {
      formMessage(form, error.message);
    } finally {
      busy = false;
      date.disabled = false;
      render();
    }
  };
  loadHours();
}

function updateNotice(item) {
  if (!['Declined', 'Cancelled'].includes(item.status)) return '';
  const named = item.status === 'Declined' ? 'declined' : 'cancelled';
  const entry = item.activity.find(entry => entry.event.toLowerCase().endsWith(named) && entry.event !== 'Reschedule offer declined');
  return `<section class="update-card update-danger">
    <h3>${item.kind === 'Court booking' ? 'Booking ' + named : 'Session request ' + named}</h3>
    ${entry ? `<p>${item.status} by ${escape(entry.actor)} · ${updateTime(entry.created)}</p>` : ''}
    <p><strong>${item.status === 'Declined' ? 'Reason' : 'Message'}:</strong> ${escape(entry?.note || 'No message was recorded.')}</p>
  </section>`;
}

export function proposalCard(booking, audience) {
  const offer = booking.proposal;
  if (!offer) return '';
  const incoming = offer.actor !== audience;
  const title = incoming ? (audience === 'Player' ? 'New time proposed' : 'Player requested a new time')
    : 'Waiting for ' + (audience === 'Staff' ? 'the player' : 'staff');
  return `<section class="update-card update-pending"><h3>${title}</h3>
    <p>${escape(offer.actor)} · ${updateTime(offer.created)}</p>
    <div class="schedule-compare">${scheduleSummary(booking, 'Original')}${scheduleSummary(offer.proposed, 'Proposed')}</div>
    ${offer.note ? `<p><strong>Message:</strong> ${escape(offer.note)}</p>` : ''}
    <p class="muted">The new time is reserved when accepted and still available.</p>
    ${incoming ? `<div class="actions"><button type="button" class="primary small" data-respond="accept" data-offer="${offer.id}" data-booking="${booking.id ?? ''}">Accept new time</button>
      <button type="button" class="secondary small" data-respond="decline" data-offer="${offer.id}" data-booking="${booking.id ?? ''}">Decline offer</button></div>` : ''}
  </section>`;
}

export function mountBookingUpdates(panel, toggle, today, alerts) {
  let identity = null;
  let item = null;
  let timer;
  let request = 0;
  let editing = false;
  let busy = false;

  function resultMarkup() {
    const schedule = item.slots ? item : { date: item.date, slots: [{ court: item.court, start: item.start, end: item.end }] };
    return `<div class="stack">
      <div class="row"><strong>${escape(item.title || item.kind)}</strong>${badge(item.status)}</div>
      ${updateNotice(item)}
      ${proposalCard(item, 'Player')}
      ${scheduleSummary(schedule, 'Booking details')}
      <p><strong>${item.slots ? 'Quoted total ' + pesos(item.total) : pesos(item.fee) + ' / player'}</strong></p>
      ${item.canReschedule ? `<div class="actions"><button type="button" class="secondary small" data-request-change>${item.proposal ? 'Suggest another time' : 'Request a new time'}</button></div>` : ''}
      ${item.activity.length ? `<details class="update-history"><summary>Recent activity</summary><ul>${item.activity.map(entry =>
        `<li><strong>${escape(entry.event)}</strong> · ${escape(entry.actor)} · ${updateTime(entry.created)}${entry.note ? `<p>${escape(entry.note)}</p>` : ''}</li>`).join('')}</ul></details>` : ''}
      ${alerts.isWatching(item.reference) ? '<button type="button" class="booking-alert-toggle text-link" data-stop-alerts>Stop alerts on this device</button>' : ''}
    </div>`;
  }

  async function update({ background = false, reset = false } = {}) {
    if (!identity || panel.hidden || (background && (busy || editing || document.hidden))) return;
    const form = $('#lookup-form', panel);
    const output = $('#lookup-result', panel);
    const submit = $('[type="submit"]', form);
    if (background && submit.disabled) return;
    const current = ++request;
    if (!background) {
      submit.disabled = true;
      formMessage(form, 'Checking…', false);
      if (reset) output.innerHTML = '';
    }
    try {
      const next = await api('lookup', identity);
      if (current !== request) return;
      const changed = JSON.stringify(next) !== JSON.stringify(item);
      item = next;
      if (reset && !identity.watchToken) alerts.remember(next.watch);
      if (changed || !background) output.innerHTML = resultMarkup();
      if (!background) {
        formMessage(form, '', false);
        form.hidden = true;
        $('[data-another-booking]', panel).hidden = false;
        if (reset) output.focus({ preventScroll: true });
      }
    } catch (error) {
      if (current === request && !background) formMessage(form, error.message);
    } finally {
      if (current === request && !background) submit.disabled = false;
    }
  }

  async function respond(action, note = '') {
    if (busy) return;
    const output = $('#lookup-result', panel);
    const feedback = $('#lookup-action-message', panel);
    const buttons = [...output.querySelectorAll('button')];
    busy = true;
    request++;
    buttons.forEach(button => { button.disabled = true; });
    feedback.textContent = 'Saving…';
    try {
      await api('reschedule', { ...identity, action, note, proposal: item.proposal.id });
      editing = false;
      await update();
      feedback.textContent = action === 'accept' ? 'Your booking moved to the new time.' : 'Offer declined. Your original booking status is unchanged.';
    } catch (error) {
      if (error.code === 'proposal-changed') {
        editing = false;
        await update();
      }
      feedback.textContent = error.message;
    } finally {
      busy = false;
      buttons.forEach(button => { button.disabled = false; });
    }
  }

  function close() {
    if (busy) return;
    clearInterval(timer);
    request++;
    identity = null;
    item = null;
    editing = false;
    busy = false;
    panel.hidden = true;
    panel.innerHTML = '';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.focus();
  }

  function open() {
    panel.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
    panel.innerHTML = `<div class="dialog-head"><h2 id="booking-updates-title">Booking updates</h2>
      <button type="button" class="icon-button" aria-label="Close booking updates" data-close-updates>×</button></div>
      <form class="stack" id="lookup-form">
        <label>Booking reference<input name="reference" placeholder="Your booking reference" required maxlength="24" autocapitalize="characters"></label>
        <label>Mobile number<input name="mobile" type="tel" autocomplete="tel" placeholder="Mobile used for the request" required maxlength="24"></label>
        <p class="form-message" role="status"></p><button class="primary" type="submit">Check status</button>
      </form><button class="secondary small" type="button" data-another-booking hidden>Check another booking</button>
      <p class="form-message" id="lookup-action-message" role="status"></p><div id="lookup-result" tabindex="-1" aria-live="polite"></div>`;
    const form = $('#lookup-form', panel);
    const output = $('#lookup-result', panel);
    const another = $('[data-another-booking]', panel);
    $('[data-close-updates]', panel).onclick = close;
    another.onclick = () => {
      if (busy) return;
      request++;
      identity = null;
      item = null;
      editing = false;
      form.reset();
      form.hidden = false;
      another.hidden = true;
      output.innerHTML = '';
      $('#lookup-action-message', panel).textContent = '';
      form.elements.reference.focus();
    };
    form.elements.reference.focus();
    form.onsubmit = event => {
      event.preventDefault();
      if (busy) return;
      identity = fieldValues(form);
      item = null;
      editing = false;
      $('#lookup-action-message', panel).textContent = '';
      update({ reset: true });
    };
    output.onclick = event => {
      if (!item || !identity || busy) return;
      const control = event.target.closest('button');
      if (!control) return;
      if ('stopAlerts' in control.dataset) {
        alerts.forget(item.reference);
        $('#lookup-action-message', panel).textContent = 'Alerts stopped for this booking on this device.';
        control.remove();
      } else if (control.dataset.respond === 'accept') {
        respond('accept');
      } else if (control.dataset.respond === 'decline') {
        editing = true;
        request++;
        output.insertAdjacentHTML('beforeend', `<form class="stack update-reply">
          <label>Reason (optional)<textarea name="note" maxlength="500" rows="2"></textarea></label>
          <div class="actions"><button class="secondary" type="submit">Decline this offer</button><button type="button" class="secondary" data-back>Go back</button></div></form>`);
        const reply = $('.update-reply', output);
        for (const button of output.querySelectorAll('[data-respond], [data-request-change]')) button.disabled = true;
        reply.elements.note.focus();
        $('[data-back]', reply).onclick = () => { editing = false; output.innerHTML = resultMarkup(); };
        reply.onsubmit = event => { event.preventDefault(); respond('decline', reply.elements.note.value); };
      } else if ('requestChange' in control.dataset) {
        editing = true;
        request++;
        output.innerHTML = scheduleSummary(item, 'Original booking') + scheduleEditor(item, today, 'Send suggested time');
        const editor = $('.schedule-editor', output);
        editor.elements.date.focus();
        bindScheduleEditor(editor, item, async draft => {
          busy = true;
          try {
            await api('reschedule', { ...identity, ...draft, action: 'propose', proposal: item.proposal?.id ?? null });
            editing = false;
            await update();
          } finally {
            busy = false;
          }
        }, () => { editing = false; output.innerHTML = resultMarkup(); });
      }
    };
    timer = setInterval(() => update({ background: true }), 20_000);
  }

  toggle.onclick = () => panel.hidden ? open() : close();
  panel.addEventListener('keydown', event => { if (event.key === 'Escape' && !busy) close(); });
  document.addEventListener('visibilitychange', () => update({ background: true }));
  return {
    show(token) {
      if (busy || editing) return false;
      if (panel.hidden) open();
      $('#lookup-form', panel).hidden = false;
      $('[data-another-booking]', panel).hidden = true;
      $('#lookup-action-message', panel).textContent = '';
      identity = { watchToken: token };
      item = null;
      update({ reset: true });
      return true;
    }
  };
}
