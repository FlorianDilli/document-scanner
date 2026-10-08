// main.js – app bootstrap: loads persisted pages, wires the
// views together, handles navigation, language switching,
// and PWA installation / updates.

import * as state from './state.js';
import * as storage from './storage.js';
import { applyI18n, getLang, setLang, t } from './i18n.js';
import { pickFromCamera, pickFromGallery } from './camera.js';
import { toast, toastAction, showBusy, hideBusy, confirmAction } from './ui.js';
import * as home from './views/home.js';
import * as editor from './views/pageEditor.js';
import * as exportView from './views/export.js';

const views = {
  home,
  editor,
  export: exportView,
};

let currentView = 'home';
let currentParams = {};

function navigate(view, params = {}) {
  currentView = view;
  currentParams = params;
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  document.getElementById('view-' + view).classList.remove('hidden');
  // Editor is a focused full-screen task: the app header is hidden
  // there and the editor toolbar becomes the top row.
  document.body.classList.toggle('editor-open', view === 'editor');
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

// ---------- standalone viewport fix ----------

// iOS standalone web apps mis-report 100dvh on cold start as the
// screen height minus the status-bar inset (WebKit bug 254868),
// sinking the shell and leaving a system gap at the bottom. The
// pre-paint bootstrap (js/viewport.js) already pins --app-height
// to 100vh; re-assert it whenever the app returns to the foreground
// in case iOS reset the inline style or the value went stale.
function setupStandaloneViewport() {
  const root = document.documentElement;
  const apply = () => {
    if (navigator.standalone === true) {
      root.style.setProperty('--app-height', '100vh');
    }
  };
  apply();
  window.addEventListener('pageshow', apply);
  document.addEventListener('visibilitychange', apply);
  // Standalone quirk: after the keyboard closes, iOS can leave the
  // visual viewport scrolled up, so the top of the app stays hidden.
  // The document itself never scrolls (the shell is fixed-height),
  // so resetting the root scroll is always safe.
  window.addEventListener('focusout', () => {
    if (navigator.standalone === true) window.scrollTo(0, 0);
  });
}

// ---------- PWA ----------

function setupPwa() {
  if (!('serviceWorker' in navigator)) return;

  // Ask for a service worker update check whenever the app comes to
  // the foreground: iOS home screen apps otherwise keep running a
  // stale worker until a navigation the OS feels like checking.
  const checkForUpdate = () => {
    if (document.visibilityState !== 'visible') return;
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg) reg.update().catch(() => {});
    });
  };
  document.addEventListener('visibilitychange', checkForUpdate);

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

  // Reload once a NEW service worker has taken over – but only if
  // this page was already controlled: the very first install of a
  // service worker claims this client too (controllerchange), and
  // reloading there would yank the user out of what they were
  // doing (e.g. the frame editor during an import).
  let refreshing = false;
  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    if (!hadController) {
      hadController = true;
      return;
    }
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
  editor.init(ctx);
  exportView.init(ctx);

  setupStandaloneViewport();
  setupPwa();

  // Debug mode (?debug=1): log timings of pipeline steps.
  if (new URLSearchParams(window.location.search).has('debug')) {
    window.__debug = true;
    console.log('[debug] mode on');
  }
}

init();
