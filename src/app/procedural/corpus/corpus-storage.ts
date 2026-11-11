import { CorpusFile } from './corpus.types';

const DB_NAME = 'tp-track-editor';
const DB_VERSION = 1;
const STORE_NAME = 'corpus';
const KEY = 'imported';

interface StoredCorpus {
  saved_at: number;
  corpus: CorpusFile;
}

export async function loadStoredCorpus(): Promise<CorpusFile | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    const stored = await new Promise<StoredCorpus | null>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(KEY);
      request.onsuccess = () => resolve((request.result as StoredCorpus | undefined) ?? null);
      request.onerror = () => resolve(null);
    });
    if (!stored || !Array.isArray(stored.corpus?.tracks) || stored.corpus.tracks.length === 0) {
      return null;
    }
    return stored.corpus;
  } finally {
    db.close();
  }
}

export async function saveStoredCorpus(corpus: CorpusFile): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put({ saved_at: Date.now(), corpus } satisfies StoredCorpus, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
  } finally {
    db.close();
  }
}

export async function clearStoredCorpus(): Promise<void> {
  const db = await openDatabase();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}
