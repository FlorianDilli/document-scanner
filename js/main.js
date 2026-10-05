// main.js – app bootstrap: loads persisted pages, wires the
// views together, handles navigation, language switching,
// and PWA installation / updates.

import * as state from './state.js';
import * as storage from './storage.js';
import { applyI18n, getLang, setLang, t } from './i18n.js';
import { pickFromCamera, pickFromGallery } from './camera.js';
import { toast, toastAction, showBusy, hideBusy, confirmAction } from './ui.js';
import * as home from './views/home.js';
import * as crop from './views/crop.js';
import * as edit from './views/edit.js';
import * as exportView from './views/export.js';

const views = {
  home,
  crop,
  edit,
  export: exportView,
};

let currentView = 'home';
let currentParams = {};

function navigate(view, params = {}) {
  currentView = view;
  currentParams = params;
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById('view-' + view).classList.remove('hidden');
  window.scrollTo(0, 0);
  views[view].show(params);
}

// Shared context handed to every view.
const ctx = {
  t,
  navigate,
  toast,
  toastAction,
  showBusy,
  hideBusy,
  confirmAction,
  pickFromCamera,
  pickFromGallery,
};

// ---------- PWA ----------

function setupPwa() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker
    .register('./sw.js', { scope: './' })
    .then((reg) => {
      // "Update available" flow: a new SW is waiting;
      // ask the user, then skip waiting and reload.
      reg.addEventListener('updatefound', () => {
        const newWorker = reg.installing;
        if (!newWorker) return;
        newWorker.addEventListener('statechange', () => {
          if (
            newWorker.state === 'installed' &&
            navigator.serviceWorker.controller
          ) {
            document.getElementById('update-banner').classList.remove('hidden');
          }
        });
      });
    })
    .catch((err) => console.warn('SW registration failed', err));

  // Reload once the new SW has taken over.
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  // Native install prompt (Chrome/Edge/Android).
  let deferredPrompt = null;
  const banner = document.getElementById('install-banner');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    banner.classList.remove('hidden');
  });
  document.getElementById('btn-install').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch (err) { /* dismissed */ }
    deferredPrompt = null;
    banner.classList.add('hidden');
  });
  document.getElementById('btn-install-dismiss').addEventListener('click', () => {
    banner.classList.add('hidden');
  });
  window.addEventListener('appinstalled', () => {
    banner.classList.add('hidden');
  });

  document.getElementById('btn-update').addEventListener('click', () => {
    // Tell the waiting SW to skip waiting; the
    // controllerchange handler above reloads the page.
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    });
  });
}

// ---------- language ----------

function setupLanguage() {
  const btn = document.getElementById('btn-language');
  const update = () => {
    btn.textContent = getLang().toUpperCase();
  };
  btn.addEventListener('click', () => {
    setLang(getLang() === 'de' ? 'en' : 'de');
    applyI18n();
    update();
    // Re-render the current view so dynamic strings
    // (page counter, filter chips, ...) update too.
    navigate(currentView, currentParams);
  });
  update();
}

// ---------- boot ----------

async function init() {
  applyI18n();
  setupLanguage();

  // Restore persisted pages.
  showBusy(t('busyLoading'));
  try {
    const records = await storage.loadAllPages();
    state.replaceAll(records);
  } catch (err) {
    console.error('Failed to load pages', err);
    toast(t('errGeneric'));
  }
  hideBusy();

  // Wire views.
  home.init(ctx);
  crop.init(ctx);
  edit.init(ctx);
  exportView.init(ctx);

  setupPwa();

  // Debug mode (?debug=1): log timings of pipeline steps.
  if (new URLSearchParams(window.location.search).has('debug')) {
    window.__debug = true;
    console.log('[debug] mode on');
  }
}

init();
