import { $, api, badge, dialog, escape, fieldValues, fillVenue, formMessage, fromTime, hhmm, longDate, pesos, playerFields, range, time } from './shared.js';
import { bindScheduleEditor, proposalCard, scheduleEditor, scheduleSummary, updateTime } from './booking-updates.js';

const tabs = [['agenda', 'Agenda'], ['sessions', 'Sessions'], ['history', 'History'], ['settings', 'Settings'], ['reports', 'Reports']];
const feedback = '<p class="form-message" role="status"></p>';
const removeLabels = {
  confirm: 'Confirm', decline: 'Decline', cancel: 'Cancel booking',
  checkIn: 'Check in', release: 'Release spot', promote: 'Promote'
};

export async function startStaff(main) {
  let today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  let date = today;
  let scheduleDate;
  let activityDate;
  let data;
  let activity = [];
  let tab = 'agenda';
  let calendarView = 'agenda';
  let calendarPeriod = 'all';
  let currentNotice = '';
  let loading = false;

  try {
    const state = await api('bootstrap');
    fillVenue(state.venue);
    today = state.today;
    date = today;
  } catch {
    currentNotice = 'Venue details will load after sign-in.';
  }
  await refresh();

  async function refresh(notice = '') {
    if (loading) return;
    loading = true;
    currentNotice = notice;
    if (data) {
      $('#staff-date', main)?.setAttribute('disabled', '');
      $('#staff-notice', main).textContent = 'Updating dashboard…';
    }
    try {
      const query = '?date=' + encodeURIComponent(date);
      if (tab === 'history') {
        activity = (await api('staff/history' + query)).items;
      } else {
        data = await api('staff/day' + query);
        fillVenue(data.venue);
      }
      render();
    } catch (error) {
      if (error.status === 401) {
        data = null;
        signIn();
      } else if (data) {
        if (tab !== 'history') date = data.date;
        currentNotice = error.message;
        render();
      } else {
        main.innerHTML = `<section class="shell page-message" role="alert"><h1>Dashboard unavailable</h1><p>${escape(error.message)}</p><a href="/staff" class="secondary">Try again</a></section>`;
      }
    } finally {
      loading = false;
    }
  }

  function signIn() {
    main.innerHTML = `<section class="staff-gateway"><div class="panel login-panel">
      <h1>Staff sign-in</h1><p>Manage court bookings, schedules, and sessions.</p>
      <form class="stack" id="login-form">
        <label>Username<input name="username" autocomplete="username" required maxlength="100"></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label>
        ${feedback}<button class="primary full" type="submit">Sign in</button>
      </form><a href="/" class="text-link">Back to player booking</a>
    </div></section>`;
    $('#login-form', main).onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const submit = $('[type=submit]', form);
      submit.disabled = true;
      try {
        await api('staff/login', fieldValues(form));
        await refresh();
      } catch (error) {
        formMessage(form, error.message);
      } finally {
        submit.disabled = false;
      }
    };
  }

  function render(focus) {
    main.innerHTML = `<section class="shell staff-workspace">
      <header class="staff-heading"><div><p class="eyebrow">Staff operations</p><h1>Club dashboard</h1><p>${longDate(date)} · Cebu time</p></div>
      <div class="staff-controls"><label>${tab === 'history' ? 'Activity date' : 'Schedule date'}<input type="date" id="staff-date" value="${date}" required></label>
      <button type="button" class="secondary" data-logout>Sign out</button></div></header>
      <nav class="flow-nav staff-nav" aria-label="Dashboard sections"><div class="flow-links">
        ${tabs.map(([id, name]) => `<button type="button" data-staff-tab="${id}" aria-current="${tab === id}">${name}</button>`).join('')}
      </div></nav>
      <p id="staff-notice" class="form-message" role="status">${escape(currentNotice)}</p>
      ${({ agenda, sessions, history, settings, reports })[tab]()}
    </section>`;
    $('#staff-date', main).onchange = event => {
      if (event.target.validity.valid) {
        date = event.target.value;
        refresh();
      }
    };
    if (focus) $(focus, main)?.focus();
  }

  function agenda() {
    return `<div class="staff-grid ${calendarView === 'grid' ? 'with-calendar-grid' : ''}">
      <section class="panel staff-panel"><div class="panel-heading"><div><h2>${calendarView === 'grid' ? 'Court calendar' : 'Court agenda'}</h2><p>Private bookings, sessions, and court blocks.</p></div>
        <div class="actions"><button type="button" class="secondary" data-form="block">Block court</button>
          <button type="button" class="primary" data-form="manual">Add booking</button></div></div>
        <div class="calendar-toolbar"><div class="actions" aria-label="Calendar view">
          <button type="button" class="secondary small" data-calendar-view="agenda" aria-pressed="${calendarView === 'agenda'}">Agenda list</button>
          <button type="button" class="secondary small" data-calendar-view="grid" aria-pressed="${calendarView === 'grid'}">Calendar grid</button>
        </div>${calendarView === 'grid' ? `<label>Hours shown<select id="calendar-period">
          ${[['all', 'All day'], ['6', 'Morning'], ['12', 'Afternoon'], ['18', 'Evening'], ['0', 'Overnight']].map(([value, label]) =>
            `<option value="${value}" ${calendarPeriod === value ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label>` : ''}</div>
        ${calendarView === 'grid' ? calendarGrid() : data.courts.map(court => {
          const items = data.schedule.filter(item => item.court_id === court.id);
          return `<section class="agenda-court"><h3>${escape(court.name)}</h3>
            ${items.length ? `<ul class="agenda-list">${items.map(item => `<li><span><strong>${escape(item.label)}</strong>
              <small>${range(item.start, item.end)} · ${({ booking: 'Private booking', session: 'Session', block: 'Court block' })[item.kind]}</small></span>
              <div class="actions">${badge(item.status)}${item.kind === 'block' ? `<button type="button" class="secondary small" data-action="unblock" data-id="${item.id}">Remove</button>` : ''}</div></li>`).join('')}</ul>` : '<p class="muted">No reservations on this court.</p>'}
          </section>`;
        }).join('')}
      </section>
      <section class="panel staff-panel"><div class="panel-heading"><div><h2>Booking requests</h2><p>${data.reports.counts.Pending} pending on the selected date</p></div></div>
        ${data.bookings.length ? `<div class="stack">${[...data.bookings].sort((a, b) => Number(b.status === 'Pending') - Number(a.status === 'Pending')).map(booking => `<article class="request-card" data-booking-card="${booking.id}" tabindex="-1">
          <div class="row"><h3>${escape(booking.name)}</h3>${badge(booking.status)}</div>
          <p>${escape(booking.mobile)} · ${escape(booking.reference)}</p>
          <ul>${booking.slots.map(slot => `<li>${escape(slot.court)} · ${range(slot.start, slot.start + 60)} · ${pesos(slot.rate)}</li>`).join('')}
          ${booking.quantity ? `<li>Paddles × ${booking.quantity} · ${pesos(booking.quantity * booking.equipment_rate)}</li>` : ''}</ul>
          <p><strong>Quoted total ${pesos(booking.total)}</strong></p>
          ${proposalCard(booking, 'Staff')}
          <div class="actions">${(booking.status === 'Pending' ? ['confirm', 'decline'] : booking.status === 'Confirmed' ? ['cancel'] : []).map(action => actionButton('booking', action, booking.id)).join('')}
            ${booking.canReschedule ? `<button type="button" class="secondary small" data-propose="${booking.id}">${booking.proposal ? 'Suggest another time' : 'Propose new time'}</button>` : ''}</div>
        </article>`).join('')}</div>` : '<p class="empty compact">No booking requests on this date.</p>'}
      </section></div>`;
  }

  function calendarGrid() {
    const hourCount = calendarPeriod === 'all' ? 24 : 6;
    const firstHour = calendarPeriod === 'all' ? 0 : Number(calendarPeriod);
    const byCourt = new Map(data.courts.map(court => [court.id, data.schedule.filter(item => item.court_id === court.id)]));
    return `<div class="calendar-scroll" tabindex="0" role="region" aria-label="Court calendar, scroll to see more times and courts">
      <table class="calendar-grid">
        <caption class="visually-hidden">${longDate(date)} · Cebu time</caption>
        <thead><tr><th scope="col">Start</th>${data.courts.map(court => `<th scope="col">${escape(court.name)}</th>`).join('')}</tr></thead>
        <tbody>${Array.from({ length: hourCount }, (_, index) => {
          const hour = index + firstHour;
          const start = hour * 60;
          return `<tr><th scope="row">${time(start)}</th>${data.courts.map(court => {
            const items = byCourt.get(court.id).filter(item => item.start < start + 60 && item.end > start);
            const entries = items.map(item => {
              const detail = `<strong>${escape(item.label)}</strong><small>${range(item.start, item.end)}</small>${badge(item.status)}`;
              return item.kind === 'booking'
                ? `<button type="button" class="calendar-entry" data-grid-booking="${item.id}">${detail}</button>`
                : `<div class="calendar-entry">${detail}</div>`;
            });
            return `<td>${entries.join('') || `<span class="muted">${court.openHours[hour] ? 'Available' : 'Closed'}</span>`}</td>`;
          }).join('')}</tr>`;
        }).join('')}</tbody>
      </table></div>`;
  }

  function sessions() {
    return `<section class="panel staff-panel"><div class="panel-heading"><div><h2>Sessions and rosters</h2><p>Publish Open Play, clinics, and private lessons.</p></div>
      <button type="button" class="primary" data-form="session">Create session</button></div>
      ${data.sessions.length ? `<div class="stack">${data.sessions.map(session => `<article class="session-card">
        <div class="row"><h3>${escape(session.title)}</h3><span class="rate-label">${escape(session.type)}</span></div>
        <p>${escape(session.court)} · ${range(session.start, session.end)} · ${escape(session.skill)}${session.coach ? ' · ' + escape(session.coach) : ''}</p>
        <p>${pesos(session.fee)} per player · ${session.remaining} of ${session.capacity} places open</p>
        ${session.roster.length ? `<ul class="agenda-list roster">${session.roster.map(member => {
          const actions = {
            Pending: ['confirm', 'decline', 'release'], Confirmed: ['checkIn', 'release'],
            'Checked in': ['release'], Waitlisted: ['promote', 'decline']
          }[member.status] ?? [];
          return `<li><div><strong>${escape(member.name)}</strong><small>${escape(member.mobile)} · ${escape(member.reference)}</small></div>
            <div class="actions">${badge(member.status)}${actions.map(action => actionButton('registration', action, member.id)).join('')}</div></li>`;
        }).join('')}</ul>` : '<p class="muted">No participants yet.</p>'}
      </article>`).join('')}</div>` : '<p class="empty">No sessions on this date.</p>'}
    </section>`;
  }

  function history() {
    return `<section class="panel staff-panel"><div class="panel-heading"><div><h2>Booking history</h2>
      <p>Latest actions for the selected activity date in Cebu time.</p></div></div>
      ${activity.length ? `<ol class="history-list">${activity.map(entry => `<li>
        <details><summary><strong>${escape(entry.event)}</strong><span>${escape(entry.actor)} · ${updateTime(entry.created)}</span></summary>
          <div class="stack history-details"><p>Reference <strong>${escape(entry.reference)}</strong></p>
          ${entry.note ? `<p><strong>Message:</strong> ${escape(entry.note)}</p>` : ''}
          ${entry.previous ? `<div class="schedule-compare">${scheduleSummary(entry.previous, entry.proposed ? 'Original' : 'Booking time')}
            ${entry.proposed ? scheduleSummary(entry.proposed, 'Proposed') : ''}</div>` : ''}</div>
        </details></li>`).join('')}</ol>` : '<p class="empty">No recorded booking activity for this date.</p>'}
      ${activity.length === 100 ? '<p class="muted">Showing the 100 most recent updates for this date.</p>' : ''}
    </section>`;
  }

  function settings() {
    return `<div class="settings-layout">
      <section class="panel staff-panel"><div class="panel-heading"><div><h2>Venue details</h2><p>Shown on the player website.</p></div></div>
      <form class="stack" data-settings="venue">
        <label>Venue name<input name="name" required maxlength="100" value="${escape(data.venue.name)}"></label>
        <label>Location<input name="location" required maxlength="100" value="${escape(data.venue.location)}"></label>
        <label>Contact details<input name="contact" required maxlength="180" value="${escape(data.venue.contact)}"></label>
        ${feedback}<button type="submit" class="primary">Save venue details</button>
      </form></section>
      <section class="panel staff-panel"><div class="panel-heading"><div><h2>Hours and pricing</h2><p>Rates are in Philippine pesos per hour.</p></div></div>
      <div class="stack">${data.courts.map(court => `<form data-settings="court" data-id="${court.id}" class="request-card stack">
        <h3>${escape(court.name)}</h3>
        <label>Operating hours<select name="mode">${[['all', '24 hours'], ['custom', 'Custom hours'], ['closed', 'Closed']].map(([value, title]) =>
          `<option value="${value}" ${court.mode === value ? 'selected' : ''}>${title}</option>`).join('')}</select></label>
        <div class="form-pair court-hours" ${court.mode !== 'custom' ? 'hidden' : ''}>
          <label>Opens<input type="time" name="opens" value="${hhmm(court.opens)}" required></label>
          <label>Closes<input type="time" name="closes" value="${hhmm(court.closes)}" required></label>
        </div>
        <div class="form-pair">
          <label>Weekday rate<input type="number" name="weekday" min="0" max="100000" required value="${court.weekday}"></label>
          <label>Weekend rate<input type="number" name="weekend" min="0" max="100000" required value="${court.weekend}"></label>
        </div>${feedback}<button type="submit" class="secondary">Save ${escape(court.name)}</button></form>`).join('')}</div></section>
    </div>`;
  }

  function reports() {
    return `<section class="panel staff-panel"><div class="panel-heading"><div><h2>Daily booking report</h2><p>${longDate(date)} · Private court bookings</p></div></div>
    <dl class="report-grid">${Object.entries(data.reports.counts).map(([status, count]) => `<div class="request-card"><dt>${status}</dt><dd>${count}</dd></div>`).join('')}</dl>
    <div class="grand-total"><span>Confirmed quoted value</span><strong>${pesos(data.reports.quotedValue)}</strong></div></section>`;
  }

  function actionButton(entity, action, id) {
    return `<button class="${['confirm', 'promote'].includes(action) ? 'primary' : action === 'decline' ? 'secondary danger-button' : 'secondary'} small" type="button" data-action="${entity}" data-verb="${action}" data-id="${id}">${removeLabels[action]}</button>`;
  }

  function proposeTime(booking) {
    if (!booking) return;
    const modal = dialog('Propose a new time', scheduleSummary(booking, 'Original booking') + scheduleEditor(booking, today, 'Send proposal'));
    bindScheduleEditor($('.schedule-editor', modal), booking, async draft => {
      await api('staff/reschedule', { ...draft, id: booking.id, action: 'propose', proposal: booking.proposal?.id ?? null });
      modal.close();
      await refresh('New time proposed. The player can respond from Booking updates.');
    }, () => modal.close());
  }

  function notePrompt(title, label, required, onSubmit) {
    const modal = dialog(title, `<form class="stack"><label>${label}<textarea name="note" rows="3" maxlength="500" ${required ? 'required' : ''}></textarea></label>
      ${feedback}<div class="actions"><button class="secondary danger-button" type="submit">${title.replace(/\?$/, '')}</button>
      <button class="secondary" type="button" data-keep>Go back</button></div></form>`);
    const form = $('form', modal);
    form.elements.note.focus();
    $('[data-keep]', modal).onclick = () => modal.close();
    form.onsubmit = async event => {
      event.preventDefault();
      const submit = $('[type="submit"]', form);
      submit.disabled = true;
      try {
        await onSubmit(form.elements.note.value, modal);
      } catch (error) {
        formMessage(form, error.message);
      } finally {
        submit.disabled = false;
      }
    };
  }

  async function respondToOffer(booking, proposal, action, note = '', modal) {
    const result = await api('staff/reschedule', { id: booking, proposal, action, note });
    modal?.close();
    if (result.date) date = result.date;
    await refresh(action === 'accept' ? 'Booking moved to the new time.' : 'Offer declined. The original booking status is unchanged.');
  }

  function startForm(kind) {
    const titles = { manual: 'Add manual booking', session: 'Create session', block: 'Block a court' };
    const courtOptions = data.courts.map(court => `<option value="${court.id}">${escape(court.name)}</option>`).join('');
    const common = `<div class="form-pair"><label>Date<input type="date" name="date" required min="${today}" value="${date < today ? today : date}"></label>
      <label>Court<select name="court">${courtOptions}</select></label></div>`;
    const times = `<div class="form-pair"><label>Start time<input name="start" type="time" required value="18:00" ${kind === 'manual' ? 'step="3600"' : ''}></label>
      <label>End time<input name="end" type="time" required value="19:00" ${kind === 'manual' ? 'step="3600"' : ''}></label></div>`;
    const category = {
      manual: playerFields(),
      block: '<label>Reason<input name="reason" placeholder="Maintenance or event" required maxlength="150"></label>',
      session: `<label>Session title<input name="title" required maxlength="100"></label><div class="form-pair">
        <label>Type<select name="type"><option>Open Play</option><option>Beginner Clinic</option><option>Private Lesson</option></select></label>
        <label>Skill level<select name="skill"><option>Beginner</option><option>Intermediate</option><option>Advanced</option></select></label></div>
        <div class="form-pair"><label>Fee per player (₱)<input name="fee" type="number" min="0" max="100000" required value="250"></label>
        <label>Capacity<input name="capacity" type="number" min="1" max="250" required value="8"></label></div>
        <label id="coach-field" hidden>Coach<input name="coach" maxlength="100"></label>`
    }[kind];
    const modal = dialog(titles[kind], `<form id="staff-form" class="stack">${common}${times}${category}${feedback}
      <button type="submit" class="primary">${titles[kind]}</button></form>`);
    const form = $('#staff-form', modal);
    if (kind === 'session') {
      form.elements.type.onchange = () => {
        const type = form.elements.type.value;
        $('#coach-field', form).hidden = type === 'Open Play';
        form.elements.coach.required = type !== 'Open Play';
        form.elements.capacity.disabled = type === 'Private Lesson';
        form.elements.capacity.value = type === 'Private Lesson' ? 1 : 8;
      };
    }
    form.onsubmit = async event => {
      event.preventDefault();
      const values = fieldValues(form);
      const start = fromTime(values.start);
      const end = fromTime(values.end, true);
      const payload = { ...values, court: Number(values.court), start, end };
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
        return formMessage(form, 'End time must be after start time on the same date.');
      }
      if (kind === 'manual') {
        if (start % 60 || end % 60) return formMessage(form, 'Choose whole hours for manual bookings.');
        payload.slots = Array.from({ length: (end - start) / 60 }, (_, index) => ({ court: payload.court, start: start + index * 60 }));
      }
      if (kind === 'session') {
        payload.fee = Number(values.fee);
        payload.capacity = values.type === 'Private Lesson' ? 1 : Number(values.capacity);
      }
      await saveFromForm(form, kind, payload, () => {
        date = payload.date;
        modal.close();
      });
    };
  }

  async function saveFromForm(form, route, payload, onSuccess) {
    const button = $('[type=submit]', form);
    button.disabled = true;
    try {
      await api('staff/' + route, payload);
      onSuccess?.();
      await refresh('Saved.');
    } catch (error) {
      formMessage(form, error.message);
    } finally {
      button.disabled = false;
    }
  }

  main.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || loading) return;
    const { staffTab, form, action, verb, id, propose, respond, offer, booking, calendarView: view, gridBooking } = button.dataset;
    if (staffTab) {
      if (staffTab === tab) return;
      const leavingHistory = tab === 'history';
      if (staffTab === 'history') {
        scheduleDate = date;
        date = activityDate ?? today;
      } else if (leavingHistory) {
        activityDate = date;
        date = scheduleDate ?? today;
      }
      tab = staffTab;
      currentNotice = '';
      if (tab === 'history' || leavingHistory) await refresh();
      else render();
      $('[data-staff-tab="' + tab + '"]', main)?.focus();
    } else if (view) {
      calendarView = view;
      render('[data-calendar-view="' + view + '"]');
    } else if (gridBooking) {
      $('[data-booking-card="' + gridBooking + '"]', main)?.focus();
    } else if (form) {
      startForm(form);
    } else if (propose) {
      proposeTime(data.bookings.find(item => item.id === Number(propose)));
    } else if (respond === 'decline') {
      notePrompt('Decline offer?', 'Reason (optional)', false,
        (note, modal) => respondToOffer(Number(booking), Number(offer), respond, note, modal));
    } else if (respond === 'accept') {
      button.disabled = true;
      try {
        await respondToOffer(Number(booking), Number(offer), respond);
      } catch (error) {
        $('#staff-notice', main).textContent = error.message;
        button.disabled = false;
      }
    } else if (action) {
      if (verb === 'decline') {
        notePrompt(action === 'booking' ? 'Decline booking?' : 'Decline session request?', 'Reason shown to the player', true, async (note, modal) => {
          const result = await api('staff/' + action, { id: Number(id), action: verb, note });
          modal.close();
          await refresh('Updated to ' + result.status + '.');
        });
      } else if (['cancel', 'release'].includes(verb) || action === 'unblock') {
        const prompt = dialog(action === 'unblock' ? 'Remove court block?' : removeLabels[verb] + '?', `<div class="stack"><p>This updates the schedule or roster immediately.</p><p class="form-message" role="status"></p>
          <div class="actions"><button type="button" class="secondary" data-keep>Go back</button><button type="button" class="primary" data-proceed>Proceed</button></div></div>`);
        $('[data-keep]', prompt).onclick = () => prompt.close();
        $('[data-proceed]', prompt).onclick = () => makeAction($('[data-proceed]', prompt), action, verb, Number(id), prompt);
      } else {
        await makeAction(button, action, verb, Number(id));
      }
    } else if ('logout' in button.dataset) {
      button.disabled = true;
      try {
        await api('staff/logout', {});
        data = null;
        signIn();
      } catch (error) {
        $('#staff-notice', main).textContent = error.message;
        button.disabled = false;
      }
    }
  });

  async function makeAction(button, route, action, id, modal) {
    button.disabled = true;
    try {
      const result = await api('staff/' + route, { id, action });
      modal?.close();
      await refresh(result.status ? 'Updated to ' + result.status + '.' : 'Court block removed.');
    } catch (error) {
      const message = modal ? $('.form-message', modal) : $('#staff-notice', main);
      message.textContent = error.message;
      button.disabled = false;
    }
  }

  main.addEventListener('change', event => {
    if (event.target.id === 'calendar-period') {
      calendarPeriod = event.target.value;
      render('#calendar-period');
    } else if (event.target.matches('[data-settings] select[name=mode]')) {
      $('.court-hours', event.target.form).hidden = event.target.value !== 'custom';
    }
  });

  main.addEventListener('submit', event => {
    const form = event.target;
    if (!form.matches('[data-settings]')) return;
    event.preventDefault();
    const values = fieldValues(form);
    const kind = form.dataset.settings;
    const payload = kind === 'venue' ? { ...values, kind } : {
      kind, id: Number(form.dataset.id), mode: values.mode, weekday: Number(values.weekday),
      weekend: Number(values.weekend), opens: fromTime(values.opens), closes: fromTime(values.closes, true)
    };
    saveFromForm(form, 'settings', payload);
  });
}
