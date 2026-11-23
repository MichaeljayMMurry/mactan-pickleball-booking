import { api, escape } from './shared.js';

const storageKey = 'mactan-booking-alerts';
const maxWatches = 12;

function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
    return Array.isArray(saved) ? saved.filter(record => record && /^[A-F0-9]{16}$/.test(record.reference)
      && typeof record.token === 'string' && Number.isFinite(record.expires)).slice(0, maxWatches) : [];
  } catch {
    return [];
  }
}

export function mountBookingAlerts(host, announcer, viewDetails) {
  let tracked = readSaved();
  const notices = new Map();
  let refreshing = false;
  let previousCheck = 0;

  function save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(tracked));
    } catch {
      // Alerts can still work until this page closes when storage is unavailable.
    }
  }

  function render() {
    host.innerHTML = [...notices.values()].slice(-3).reverse().map(notice => `<div class="booking-toast toast-${notice.tone}">
      <div class="booking-toast-content"><strong>${escape(notice.title)}</strong>
        <span>Reference ${escape(notice.reference)}</span>${notice.note ? `<p>${escape(notice.note)}</p>` : ''}</div>
      <div class="actions"><button class="secondary small" type="button" data-notice-details="${escape(notice.reference)}">View details</button>
        <button class="icon-button" type="button" data-notice-dismiss="${escape(notice.reference)}" aria-label="Dismiss ${escape(notice.title)}">×</button></div></div>`).join('');
  }

  async function refresh() {
    if (document.hidden || refreshing || Date.now() - previousCheck < 1500) return;
    const active = tracked.filter(record => record.expires > Date.now());
    if (active.length !== tracked.length) {
      tracked = active;
      save();
    }
    if (!active.length) return;

    refreshing = true;
    previousCheck = Date.now();
    try {
      const { items } = await api('watch', { tokens: active.map(record => record.token) });
      let changed = false;
      const announcements = [];
      for (const { reference, notice } of items) {
        const record = tracked.find(item => item.reference === reference);
        if (!notice) {
          if (notices.delete(reference)) changed = true;
          continue;
        }
        if (!record || notice.id <= record.seen) continue;
        record.seen = notice.id;
        notices.delete(reference);
        notices.set(reference, { ...notice, reference });
        announcements.push(notice.title + '. Reference ' + reference);
        changed = true;
      }
      if (changed) {
        save();
        render();
      }
      if (announcements.length) announcer.textContent = announcements.join('. ');
    } catch {
      // Retry while the page is visible and the connection is available.
    } finally {
      refreshing = false;
    }
  }

  host.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    const { noticeDetails, noticeDismiss } = button.dataset;
    if (noticeDetails) {
      const record = tracked.find(record => record.reference === noticeDetails);
      if (!record || !viewDetails(record.token)) return;
      notices.delete(noticeDetails);
      render();
    } else if (noticeDismiss) {
      notices.delete(noticeDismiss);
      render();
    }
  });
  window.addEventListener('storage', event => {
    if (event.key === storageKey) tracked = readSaved();
  });
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('focus', refresh);
  setInterval(refresh, 12_000);
  refresh();

  return {
    remember(watch) {
      if (!watch?.token) return;
      const previous = tracked.find(record => record.reference === watch.reference);
      if (previous?.token === watch.token) return;
      tracked = [{ ...watch, seen: previous?.seen ?? watch.seen }, ...tracked.filter(record => record.reference !== watch.reference)].slice(0, maxWatches);
      save();
    },
    isWatching(reference) {
      return tracked.some(record => record.reference === reference && record.expires > Date.now());
    },
    forget(reference) {
      tracked = tracked.filter(record => record.reference !== reference);
      notices.delete(reference);
      save();
      render();
    }
  };
}
