export const $ = (selector, root = document) => root.querySelector(selector);
export const escape = value => String(value ?? '').replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
export const pesos = amount => '₱' + new Intl.NumberFormat('en-PH').format(amount);
export const longDate = value => new Intl.DateTimeFormat('en-PH', {
  timeZone: 'Asia/Manila', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
}).format(new Date(value + 'T00:00:00+08:00'));
export function time(value) {
  const hour = Math.floor(value / 60) % 24;
  return (hour % 12 || 12) + ':' + String(value % 60).padStart(2, '0') + (hour < 12 ? ' AM' : ' PM');
}
export const range = (start, end) => time(start) + ' – ' + time(end);
export const hhmm = value => String(Math.floor(value / 60) % 24).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
export function fromTime(value, end = false) {
  const [hour, minute] = String(value).split(':').map(Number);
  const result = hour * 60 + minute;
  return end && result === 0 ? 1440 : result;
}

export async function api(path, data) {
  let response, result;
  try {
    response = await fetch('/api/' + path, data === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });
    result = await response.json();
  } catch {
    throw new Error('We couldn’t reach the booking server. Please try again.');
  }
  if (!response.ok) {
    throw Object.assign(new Error(result.error || 'Please try again.'), {
      status: response.status, code: result.code, details: result.details
    });
  }
  return result;
}

export function fillVenue(venue) {
  for (const id of ['venue-name', 'footer-venue']) $('#' + id).textContent = venue.name;
  $('#venue-location').textContent = venue.location;
  $('#footer-contact').textContent = venue.contact;
  document.title = venue.name;
}

export function badge(status) {
  return `<span class="badge status-${escape(status.toLowerCase().replaceAll(' ', '-'))}">${escape(status)}</span>`;
}

export function playerFields() {
  return `<label>Player name<input name="name" autocomplete="name" placeholder="Your full name" required maxlength="100"></label>
    <label>Mobile number<input name="mobile" type="tel" autocomplete="tel" inputmode="tel" placeholder="09XXXXXXXXX" required maxlength="24"></label>`;
}

export function dialog(title, contents) {
  const element = $('#dialog');
  $('#dialog-content').innerHTML = `<header class="dialog-head"><h2 id="dialog-title">${escape(title)}</h2>
    <button type="button" class="icon-button" aria-label="Close dialog" data-close>×</button></header>${contents}`;
  const close = $('[data-close]', element);
  close.onclick = () => element.close();
  if (element.open) close.focus();
  else element.showModal();
  return element;
}

export function formMessage(form, message, error = true) {
  const output = $('.form-message', form);
  output.textContent = message;
  output.classList.toggle('error', error);
}

export function fieldValues(form) {
  return Object.fromEntries(new FormData(form));
}

export function showReceipt(result, kind) {
  const pending = result.status === 'Waitlisted'
    ? 'You’re on the waitlist. Use your reference and mobile number to check for updates.'
    : 'Staff will review your request. Keep the reference to check your status later.';
  const receipt = dialog(kind, `<div class="stack">${badge(result.status)}<p>${pending}</p>
    <div class="reference"><small>Booking reference</small><strong>${escape(result.reference)}</strong></div>
    <button type="button" class="secondary" data-done>Done</button></div>`);
  $('[data-done]', receipt).onclick = () => receipt.close();
}
