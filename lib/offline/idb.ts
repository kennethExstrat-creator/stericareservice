import type { KeyValueDatabase, KeyValueStore } from "./kv";

/* ------------------------------------------------------------------ *
 * A small typed wrapper over the raw IndexedDB API: one database, named
 * object stores with out-of-line string keys. No library: the API we need
 * is six calls.
 * ------------------------------------------------------------------ */

export interface IndexedDbOptions<S extends string> {
  name: string;
  version: number;
  /** Created on upgrade when missing. */
  stores: readonly S[];
  factory: IDBFactory;
}

export interface IndexedDatabase<S extends string> extends KeyValueDatabase<S> {
  /** Opens the connection now; rejects when the browser refuses IndexedDB. */
  ready(): Promise<void>;
}

/**
 * After these a new connection usually works: iPadOS drops the IndexedDB
 * connection of a page that sat in the background ("Connection to Indexed
 * Database server lost").
 */
const RECONNECT_ERRORS: ReadonlySet<string> = new Set(["InvalidStateError", "UnknownError", "TransactionInactiveError"]);

export function openIndexedDb<S extends string>(options: IndexedDbOptions<S>): IndexedDatabase<S> {
  const { name, version, stores, factory } = options;
  let connection: Promise<IDBDatabase> | null = null;
  let closed = false;

  function connect(): Promise<IDBDatabase> {
    if (closed) return Promise.reject(new Error(`The local database "${name}" is closed.`));
    connection ??= open().catch((error: unknown) => {
      connection = null;
      throw error;
    });
    return connection;
  }

  function open(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(name, version);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of stores) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another tab is opening a newer version: let its upgrade run and reconnect on the next call.
        db.onversionchange = () => {
          db.close();
          connection = null;
        };
        db.onclose = () => {
          connection = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error(`Could not open the local database "${name}".`));
      // onblocked needs nothing: the older tab closes on versionchange and the open proceeds.
    });
  }

  async function run<T>(
    storeName: S,
    mode: IDBTransactionMode,
    operate: (store: IDBObjectStore) => IDBRequest<T>,
    reconnect = true,
  ): Promise<T> {
    const db = await connect();
    try {
      return await transact(db, storeName, mode, operate);
    } catch (error) {
      if (!reconnect || !(error instanceof DOMException) || !RECONNECT_ERRORS.has(error.name)) throw error;
      connection = null;
      db.close();
      return run(storeName, mode, operate, false);
    }
  }

  function store<V>(storeName: S): KeyValueStore<V> {
    if (!stores.includes(storeName)) throw new Error(`Unknown store "${storeName}" in "${name}".`);
    return {
      get: (key) => run<V | undefined>(storeName, "readonly", (s) => s.get(key)),
      getAll: () => run<V[]>(storeName, "readonly", (s) => s.getAll()),
      keys: async () => (await run(storeName, "readonly", (s) => s.getAllKeys())).map(String),
      put: async (key, value) => {
        await run(storeName, "readwrite", (s) => s.put(value, key));
      },
      delete: async (key) => {
        await run(storeName, "readwrite", (s) => s.delete(key));
      },
      clear: async () => {
        await run(storeName, "readwrite", (s) => s.clear());
      },
    };
  }

  return {
    persistent: true,
    store,
    ready: async () => {
      await connect();
    },
    close() {
      closed = true;
      connection?.then((db) => db.close()).catch(() => undefined);
      connection = null;
    },
  };
}

/**
 * One request in its own transaction. Resolves on the transaction's
 * complete event, not the request's success: only then is a write
 * committed. Writes ask for strict durability (flushed to disk), since the
 * local copy is what survives a crash.
 */
function transact<T>(
  db: IDBDatabase,
  storeName: string,
  mode: IDBTransactionMode,
  operate: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode, mode === "readwrite" ? { durability: "strict" } : undefined);
    const request = operate(tx.objectStore(storeName));
    let result: T;
    request.onsuccess = () => {
      result = request.result;
    };
    const fail = () => reject(tx.error ?? request.error ?? new DOMException("The transaction was aborted.", "AbortError"));
    tx.oncomplete = () => resolve(result);
    tx.onerror = fail;
    tx.onabort = fail;
  });
}
