/**
 * One object store: string keys, structured-clone values. Values go in and
 * come out as copies, as with IndexedDB. Reads and listings are in key order.
 */
export interface KeyValueStore<V> {
  get(key: string): Promise<V | undefined>;
  getAll(): Promise<V[]>;
  keys(): Promise<string[]>;
  /** Resolves once the write is committed. */
  put(key: string, value: V): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

/** A set of named stores: one IndexedDB database, or memory. */
export interface KeyValueDatabase<S extends string = string> {
  /** False for the in-memory fallback: nothing survives a reload. */
  readonly persistent: boolean;
  store<V>(name: S): KeyValueStore<V>;
  close(): void;
}

export function createMemoryStore<V>(): KeyValueStore<V> {
  const entries = new Map<string, V>();
  const sortedKeys = () => [...entries.keys()].sort();
  return {
    async get(key) {
      const value = entries.get(key);
      return value === undefined ? undefined : structuredClone(value);
    },
    async getAll() {
      return sortedKeys().map((key) => structuredClone(entries.get(key) as V));
    },
    async keys() {
      return sortedKeys();
    },
    async put(key, value) {
      entries.set(key, structuredClone(value));
    },
    async delete(key) {
      entries.delete(key);
    },
    async clear() {
      entries.clear();
    },
  };
}

/**
 * Memory with the same interface: for tests, and for browsers without
 * IndexedDB. Asking twice for a store returns the same one, so a test can
 * "reload" by building a second controller on the same database.
 */
export function createMemoryDatabase<S extends string>(names: readonly S[]): KeyValueDatabase<S> {
  const stores = new Map<S, KeyValueStore<unknown>>(names.map((name) => [name, createMemoryStore<unknown>()]));
  return {
    persistent: false,
    store<V>(name: S): KeyValueStore<V> {
      const store = stores.get(name);
      if (!store) throw new Error(`Unknown store "${name}".`);
      return store as KeyValueStore<V>;
    },
    close() {},
  };
}
