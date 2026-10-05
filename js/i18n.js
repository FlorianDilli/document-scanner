// i18n.js – all UI strings live here. German is the default UI language.

export const STRINGS = {
  de: {
    appTitle: 'Dokumenten-Scanner',
    takePhoto: 'Foto aufnehmen',
    fromGallery: 'Aus Galerie wählen',
    importHint: 'Fotos werden lokal verarbeitet – nichts verlässt dein Gerät.',
    emptyState: 'Noch keine Seiten. Fotografiere oder importiere ein Dokument, um zu beginnen.',
    deleteAll: 'Alle löschen',
    exportPdf: 'Als PDF exportieren',
    back: 'Zurück',
    cropTitle: 'Zuschneiden',
    apply: 'Übernehmen',
    redetect: 'Erneut erkennen',
    resetCrop: 'Auf ganzes Bild',
    snapA4: 'A4-Verhältnis',
    cropHint: 'Ziehe die Ecken, um den Rahmen anzupassen.',
    backToCrop: 'Zurück zum Zuschneiden',
    editTitle: 'Bearbeiten',
    done: 'Fertig',
    brightness: 'Helligkeit',
    contrast: 'Kontrast',
    sharpen: 'Schärfe',
    rotateLeft: '↶ Links',
    rotateRight: '↷ Rechts',
    exportTitle: 'PDF exportieren',
    margin: 'Rand',
    marginNone: 'Kein Rand',
    marginSmall: 'Kleiner Rand',
    quality: 'Qualität',
    qualityNormal: 'Normal',
    qualityHigh: 'Hoch',
    qualityMax: 'Maximum',
    ocrToggle: 'Text erkennen (OCR)',
    filename: 'Dateiname',
    cancel: 'Abbrechen',
    startExport: 'PDF erstellen',
    installHint: 'App installieren',
    install: 'Installieren',
    dismiss: 'Nicht jetzt',
    updateHint: 'Neue Version verfügbar',
    reload: 'Neu laden',
    filterPhoto: 'Foto',
    filterEnhance: 'Auto',
    filterGray: 'Graustufen',
    filterBw: 'Schwarz-Weiß',
    filterDocument: 'Dokument',
    // status / progress
    busyLoading: 'Lade…',
    busyDetect: 'Dokument wird erkannt…',
    busyWarp: 'Bild wird zugeschnitten…',
    busyFilter: 'Filter wird angewendet…',
    busyOcr: 'Text wird erkannt…',
    busyPdf: 'PDF wird erstellt…',
    ocrProgress: 'OCR: Seite {current}/{total}',
    pdfProgress: 'Seite {current}/{total}',
    preparingOffline: 'Offline-Modus wird vorbereitet…',
    // errors
    errGeneric: 'Etwas ist schiefgelaufen. Bitte versuche es erneut.',
    errCvLoad: 'OpenCV konnte nicht geladen werden. Prüfe deine Verbindung und lade neu.',
    errOcr: 'OCR ist fehlgeschlagen. Die Seite wird ohne Textebene exportiert.',
    errPdf: 'PDF konnte nicht erstellt werden.',
    errDecode: 'Das Bild konnte nicht gelesen werden. Unterstützt dein Browser dieses Format (z. B. HEIC)?',
    errCamera: 'Kamerazugriff verweigert oder nicht verfügbar.',
    errMemory: 'Nicht genug Speicher. Versuche, weniger Seiten gleichzeitig zu verarbeiten.',
    confirmDeleteAll: 'Wirklich alle Seiten löschen?',
    confirmDeletePage: 'Seite löschen?',
    moveUp: 'Nach oben',
    moveDown: 'Nach unten',
    deletePage: 'Seite löschen',
    undo: 'Rückgängig',
    pageDeleted: 'Seite gelöscht',
    pageCount: '{count} Seiten',
    pageCountOne: '1 Seite',
    detectFallback: 'Dokument nicht automatisch erkannt – bitte passe die Ecken an.',
    shareFailed: 'Teilen nicht möglich – Download wird gestartet.',
    ocrFailedNote: 'OCR fehlgeschlagen – Seite ohne Textebene exportiert.',
    updateReady: 'Update bereit – bitte neu laden.',
  },
  en: {
    appTitle: 'Document Scanner',
    takePhoto: 'Take photo',
    fromGallery: 'From gallery',
    importHint: 'Photos are processed locally – nothing leaves your device.',
    emptyState: 'No pages yet. Take or import a document photo to begin.',
    deleteAll: 'Delete all',
    exportPdf: 'Export as PDF',
    back: 'Back',
    cropTitle: 'Crop',
    apply: 'Apply',
    redetect: 'Detect again',
    resetCrop: 'Full image',
    snapA4: 'A4 ratio',
    cropHint: 'Drag the corners to adjust the frame.',
    backToCrop: 'Back to crop',
    editTitle: 'Edit',
    done: 'Done',
    brightness: 'Brightness',
    contrast: 'Contrast',
    sharpen: 'Sharpen',
    rotateLeft: '↶ Left',
    rotateRight: '↷ Right',
    exportTitle: 'Export PDF',
    margin: 'Margin',
    marginNone: 'No margin',
    marginSmall: 'Small margin',
    quality: 'Quality',
    qualityNormal: 'Normal',
    qualityHigh: 'High',
    qualityMax: 'Maximum',
    ocrToggle: 'Recognize text (OCR)',
    filename: 'Filename',
    cancel: 'Cancel',
    startExport: 'Create PDF',
    installHint: 'Install app',
    install: 'Install',
    dismiss: 'Not now',
    updateHint: 'Update available',
    reload: 'Reload',
    filterPhoto: 'Photo',
    filterEnhance: 'Auto',
    filterGray: 'Grayscale',
    filterBw: 'Black & White',
    filterDocument: 'Document',
    // status / progress
    busyLoading: 'Loading…',
    busyDetect: 'Detecting document…',
    busyWarp: 'Cropping image…',
    busyFilter: 'Applying filter…',
    busyOcr: 'Recognizing text…',
    busyPdf: 'Creating PDF…',
    ocrProgress: 'OCR: page {current}/{total}',
    pdfProgress: 'Page {current}/{total}',
    preparingOffline: 'Preparing offline mode…',
    // errors
    errGeneric: 'Something went wrong. Please try again.',
    errCvLoad: 'Could not load OpenCV. Check your connection and reload.',
    errOcr: 'OCR failed. The page will be exported without a text layer.',
    errPdf: 'Could not create the PDF.',
    errDecode: 'Could not read the image. Does your browser support this format (e.g. HEIC)?',
    errCamera: 'Camera access denied or unavailable.',
    errMemory: 'Out of memory. Try processing fewer pages at once.',
    confirmDeleteAll: 'Delete all pages?',
    confirmDeletePage: 'Delete page?',
    moveUp: 'Move up',
    moveDown: 'Move down',
    deletePage: 'Delete page',
    undo: 'Undo',
    pageDeleted: 'Page deleted',
    pageCount: '{count} pages',
    pageCountOne: '1 page',
    detectFallback: 'Document not detected automatically – please adjust the corners.',
    shareFailed: 'Sharing not possible – starting download.',
    ocrFailedNote: 'OCR failed – page exported without text layer.',
    updateReady: 'Update ready – please reload.',
  },
};

// Language choice: default German, English if the browser is set to English.
// Stored in localStorage (small preference only – images never go there).
const STORAGE_KEY = 'scanner-lang';

function detectLanguage() {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && STRINGS[stored]) return stored;
  const nav = (navigator.language || 'de').toLowerCase();
  return nav.startsWith('en') ? 'en' : 'de';
}

let currentLang = detectLanguage();

export function t(key, vars) {
  let s = (STRINGS[currentLang] && STRINGS[currentLang][key]) || STRINGS.de[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}

export function getLang() {
  return currentLang;
}

export function setLang(lang) {
  if (!STRINGS[lang]) return;
  currentLang = lang;
  localStorage.setItem(STORAGE_KEY, lang);
}

// Apply all [data-i18n] strings in the DOM. Called after language changes.
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
  document.documentElement.lang = currentLang;
  document.title = t('appTitle');
}
