// Minimal promise wrapper around IndexedDB. Everything the user imports or saves stays in this
// browser profile; nothing is uploaded anywhere.

const DB_NAME = "hippogriff-moo2";
const DB_VERSION = 1;
export const STORE_FILES = "install-files";
export const STORE_META = "meta";
export const STORE_SAVES = "saves";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of [STORE_FILES, STORE_META, STORE_SAVES]) if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return done(db.transaction(store, "readonly").objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await done(db.transaction(store, "readwrite").objectStore(store).put(value, key));
}

export async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  await done(db.transaction(store, "readwrite").objectStore(store).delete(key));
}

export async function idbKeys(store: string): Promise<string[]> {
  const db = await openDb();
  return (await done(db.transaction(store, "readonly").objectStore(store).getAllKeys())).map(String);
}

export async function idbClear(store: string): Promise<void> {
  const db = await openDb();
  await done(db.transaction(store, "readwrite").objectStore(store).clear());
}
