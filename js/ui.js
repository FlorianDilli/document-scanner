// ui.js – shared UI helpers: toast messages, busy overlay,
// confirm dialogs. Keeps view code free of DOM plumbing.

let toastTimer = null;

export function toast(message, ms = 3200) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

// Toast with an action button (e.g. Undo). Returns a promise
// that resolves true if the action was clicked.
export function toastAction(message, actionLabel, ms = 5000) {
  return new Promise((resolve) => {
    const el = document.getElementById('toast');
    el.textContent = '';
    const span = document.createElement('span');
    span.textContent = message;
    const btn = document.createElement('button');
    btn.className = 'btn btn-primary';
    btn.style.minHeight = '36px';
    btn.style.padding = '4px 12px';
    btn.style.marginLeft = '12px';
    btn.textContent = actionLabel;
    el.appendChild(span);
    el.appendChild(btn);
    el.classList.remove('hidden');
    let done = false;
    const finish = (val) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      btn.removeEventListener('click', onClick);
      el.classList.add('hidden');
      el.textContent = '';
      resolve(val);
    };
    const onClick = () => finish(true);
    btn.addEventListener('click', onClick);
    const timer = setTimeout(() => finish(false), ms);
  });
}

export function showBusy(text) {
  document.getElementById('busy-text').textContent = text;
  document.getElementById('busy-overlay').classList.remove('hidden');
}

export function hideBusy() {
  document.getElementById('busy-overlay').classList.add('hidden');
}

export function confirmAction(message) {
  return Promise.resolve(window.confirm(message));
}

// Show a user-facing error (German message) and log details.
export function showError(err, messageKey, { t } = {}) {
  const msg = t ? t(messageKey) : (messageKey || 'Fehler');
  console.error(err);
  toast(msg, 5000);
}
