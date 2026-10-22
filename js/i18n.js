// i18n.js – all UI strings live here. The app has a single UI
// language: German.

export const STRINGS = {
  appTitle: 'Dokumenten-Scanner',
  newScan: 'Neu scannen',
  newScanHint: 'Wähle eine Quelle, um ein Dokument zu scannen.',
  takePhoto: 'Foto aufnehmen',
  fromGallery: 'Aus Galerie wählen',
  importHint: 'Fotos werden lokal verarbeitet – nichts verlässt dein Gerät.',
  yourScans: 'Deine Scans',
  emptyState: 'Noch keine Seiten. Fotografiere oder importiere ein Dokument, um zu beginnen.',
  deleteAll: 'Alle löschen',
  exportAction: 'Exportieren',
  back: 'Zurück',
  modeFrame: 'Rahmen',
  modeLook: 'Optik',
  filmstripLabel: 'Seiten wechseln',
  goToPage: 'Zu Seite {i}',
  redetect: 'Erneut erkennen',
  redetectDisabled: 'Keine Kanten erkannt',
  resetCrop: 'Auf ganzes Bild',
  invalidFrame: 'Der Rahmen ist ungültig – bitte passe die Ecken an.',
  cropPending: 'Rahmen prüfen',
  orientationPortrait: 'Hochformat',
  orientationLandscape: 'Querformat',
  done: 'Fertig',
  brightness: 'Helligkeit',
  contrast: 'Kontrast',
  sharpen: 'Schärfe',
  rotate: 'Drehen',
  zoomIn: 'Vergrößern',
  zoomOut: 'Verkleinern',
  exportTitle: 'Exportieren',
  quality: 'Qualität',
  qualityLow: 'Niedrig',
  qualityMedium: 'Mittel',
  qualityHigh: 'Hoch',
  format: 'Format',
  formatPdf: 'PDF',
  formatImages: 'Bilder',
  formatHintImages: 'Speichert jede Seite als JPEG in der gewählten Qualität – über das Teilen-Menü landen die Bilder in der Kamerarolle.',
  ocrToggle: 'Text erkennen (OCR)',
  filename: 'Dateiname',
  cancel: 'Abbrechen',
  startExport: 'PDF erstellen',
  startExportImages: 'Bilder speichern',
  busyImages: 'Bilder werden erstellt…',
  imageProgress: 'Bild {current}/{total}',
  imagesSaved: 'Bilder gespeichert',
  imagesDownloaded: 'Bilder heruntergeladen – im Download-Ordner verfügbar.',
  installHint: 'App installieren',
  install: 'Installieren',
  dismiss: 'Nicht jetzt',
  updateHint: 'Neue Version verfügbar',
  reload: 'Neu laden',
  filterPhoto: 'Foto',
  filterDocument: 'Dokument',
  filterDocumentColor: 'Dokument Farbe',
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
  errImages: 'Bilder konnten nicht erstellt werden.',
  errDecode: 'Das Bild konnte nicht gelesen werden. Unterstützt dein Browser dieses Format (z. B. HEIC)?',
  errCamera: 'Kamerazugriff verweigert oder nicht verfügbar.',
  errMemory: 'Nicht genug Speicher. Versuche, weniger Seiten gleichzeitig zu verarbeiten.',
  confirmDeleteAll: 'Wirklich alle Seiten löschen?',
  confirmDeletePage: 'Seite löschen?',
  gripMove: 'Seite {i} neu anordnen (Pfeiltasten hoch/runter)',
  openPage: 'Seite {i} öffnen',
  deletePage: 'Seite löschen',
  undo: 'Rückgängig',
  pageDeleted: 'Seite gelöscht',
  resetPage: 'Zurücksetzen',
  confirmResetPage: 'Alle Änderungen dieser Seite zurücksetzen (Rahmen, Drehung, Filter, Regler)?',
  detectProgress: 'Kanten werden erkannt… {current}/{total}',
  exportCancelled: 'Export abgebrochen.',
  pageCount: '{count} Seiten',
  pageCountOne: '1 Seite',
  shareFailed: 'Teilen nicht möglich – Download wird gestartet.',
  ocrFailedNote: 'OCR fehlgeschlagen – Seite ohne Textebene exportiert.',
  updateReady: 'Update bereit – bitte neu laden.',
};

export function t(key, vars) {
  let s = STRINGS[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(`{${k}}`, String(v));
    }
  }
  return s;
}

// Apply all [data-i18n] strings in the DOM. The language is fixed,
// so there is nothing to switch – this only fills the markup once.
export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.getAttribute('data-i18n'));
  });
}
