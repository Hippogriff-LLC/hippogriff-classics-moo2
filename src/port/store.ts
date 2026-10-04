// Browser-local storage for the port: the user's installation and private build as Blobs, and the save
// directory the game writes. Everything stays in this browser profile; nothing is uploaded.
//
// Independently authored; Apache-2.0.

const DB_NAME = "hippogriff-moo2-port";
export const GAME = "game"; // upper-cased file name -> Blob (top-level files of the installation)
export const BUILD = "build"; // moo2.wasm, image.bin, entry.txt -> Blob
export const SAVES = "saves"; // upper-cased file name -> Uint8Array

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of [GAME, BUILD, SAVES]) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
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

export async function getAll<T>(store: string): Promise<[string, T][]> {
  const db = await openDb();
  const os = db.transaction(store, "readonly").objectStore(store);
  const [keys, values] = await Promise.all([done(os.getAllKeys()), done(os.getAll())]);
  return keys.map((k, i) => [String(k), values[i] as T]);
}

export async function put(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await done(db.transaction(store, "readwrite").objectStore(store).put(value, key));
}

export async function remove(store: string, key: string): Promise<void> {
  const db = await openDb();
  await done(db.transaction(store, "readwrite").objectStore(store).delete(key));
}

/** Replace a store's contents in one transaction. */
export async function replaceAll(store: string, entries: [string, unknown][]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(store, "readwrite");
  const os = tx.objectStore(store);
  os.clear();
  for (const [k, v] of entries) os.put(v, k);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
