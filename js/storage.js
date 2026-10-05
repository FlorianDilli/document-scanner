// storage.js – IndexedDB persistence for pages (blobs + metadata).
// Blobs are stored directly in IndexedDB; localStorage is never used for
// image data. A reload or killed tab does not lose work.

const DB_NAME = 'document-scanner';
const DB_VERSION = 1;
const STORE = 'pages';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const result = fn(store);
    t.oncomplete = () => resolve(result && result._value !== undefined ? result._value : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

// Persist a page: { id, blob, width, height, corners, rotation, filter, params, ocr }
export async function savePage(page) {
  const db = await openDb();
  const record = {
    id: page.id,
    blob: page.blob,
    width: page.width,
    height: page.height,
    corners: page.corners,
    rotation: page.rotation,
    filter: page.filter,
    params: page.params,
    ocr: page.ocr,
  };
  await tx(db, 'readwrite', (store) => store.put(record));
  db.close();
}

export async function loadAllPages() {
  const db = await openDb();
  const records = await new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readonly');
    const req = t.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return records;
}

export async function deletePage(id) {
  const db = await openDb();
  await tx(db, 'readwrite', (store) => store.delete(id));
  db.close();
}

export async function clearAllPages() {
  const db = await openDb();
  await tx(db, 'readwrite', (store) => store.clear());
  db.close();
}

// Update only the OCR cache of a page (avoids
// re-writing the whole blob when OCR completes).
export async function savePageOcr(id, ocr) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const t = db.transaction(STORE, 'readwrite');
    const store = t.objectStore(STORE);
    const getReq = store.get(id);
    getReq.onsuccess = () => {
      const record = getReq.result;
      if (record) {
        record.ocr = ocr;
        store.put(record);
      }
    };
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  db.close();
}
