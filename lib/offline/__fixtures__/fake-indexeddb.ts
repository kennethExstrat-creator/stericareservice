// A small in-memory stand-in for the part of IndexedDB that lib/offline/idb.ts
// uses. Events fire asynchronously, and a write is applied only when its
// transaction commits, as in browsers, so a wrapper that resolved too early
// would be caught.

type Handler = (() => void) | null;

const later = (fn: () => void) => {
  void Promise.resolve().then(fn);
};

type Operation = "get" | "getAll" | "getAllKeys" | "put" | "delete" | "clear";

class FakeRequest<T = unknown> {
  result = undefined as T;
  error: DOMException | null = null;
  onsuccess: Handler = null;
  onerror: Handler = null;
}

class FakeOpenRequest extends FakeRequest<FakeDatabase> {
  onupgradeneeded: Handler = null;
  onblocked: Handler = null;
}

class FakeObjectStore {
  constructor(private readonly tx: FakeTransaction) {}

  get(key: string) {
    return this.tx.request("get", (entries) => {
      const value = entries.get(key);
      return value === undefined ? undefined : structuredClone(value);
    });
  }

  getAll() {
    return this.tx.request("getAll", (entries) => sorted(entries).map(([, value]) => structuredClone(value)));
  }

  getAllKeys() {
    return this.tx.request("getAllKeys", (entries) => sorted(entries).map(([key]) => key));
  }

  put(value: unknown, key: string) {
    const copy = structuredClone(value);
    return this.tx.request("put", (entries, commit) => {
      commit(() => entries.set(key, copy));
      return key;
    });
  }

  delete(key: string) {
    return this.tx.request("delete", (entries, commit) => {
      commit(() => entries.delete(key));
      return undefined;
    });
  }

  clear() {
    return this.tx.request("clear", (entries, commit) => {
      commit(() => entries.clear());
      return undefined;
    });
  }
}

function sorted(entries: Map<string, unknown>): [string, unknown][] {
  return [...entries.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
}

class FakeTransaction {
  oncomplete: Handler = null;
  onerror: Handler = null;
  onabort: Handler = null;
  error: DOMException | null = null;

  constructor(
    private readonly entries: Map<string, unknown>,
    private readonly factory: FakeIndexedDb,
  ) {}

  objectStore() {
    return new FakeObjectStore(this);
  }

  request<T>(operation: Operation, run: (entries: Map<string, unknown>, commit: (apply: () => void) => void) => T) {
    const request = new FakeRequest<T>();
    later(() => {
      const failure = this.factory.takeFailure(operation);
      if (failure) {
        request.error = failure;
        this.error = failure;
        request.onerror?.();
        this.onerror?.();
        this.onabort?.();
        return;
      }
      const writes: (() => void)[] = [];
      request.result = run(this.entries, (apply) => writes.push(apply));
      request.onsuccess?.();
      later(() => {
        for (const apply of writes) apply();
        this.oncomplete?.();
      });
    });
    return request;
  }
}

class FakeDatabase {
  onversionchange: Handler = null;
  onclose: Handler = null;
  closed = false;

  constructor(
    private readonly stores: Map<string, Map<string, unknown>>,
    private readonly factory: FakeIndexedDb,
  ) {}

  get objectStoreNames() {
    return { contains: (name: string) => this.stores.has(name) };
  }

  createObjectStore(name: string) {
    this.stores.set(name, new Map());
  }

  transaction(name: string, mode: IDBTransactionMode, options?: IDBTransactionOptions) {
    if (this.closed) throw new DOMException("The database connection is closing.", "InvalidStateError");
    const entries = this.stores.get(name);
    if (!entries) throw new DOMException(`No objectStore named ${name}.`, "NotFoundError");
    this.factory.transactions.push({ store: name, mode, durability: options?.durability });
    return new FakeTransaction(entries, this.factory);
  }

  close() {
    this.closed = true;
  }
}

export class FakeIndexedDb {
  readonly databases = new Map<string, { version: number; stores: Map<string, Map<string, unknown>> }>();
  readonly connections: FakeDatabase[] = [];
  readonly transactions: { store: string; mode: IDBTransactionMode; durability?: IDBTransactionDurability }[] = [];
  opens = 0;
  /** Set to make open() fail, as private windows of some browsers do. */
  refuseOpen: DOMException | null = null;
  private readonly failures: { operation: Operation; error: DOMException }[] = [];

  open(name: string, version: number) {
    this.opens++;
    const request = new FakeOpenRequest();
    later(() => {
      if (this.refuseOpen) {
        request.error = this.refuseOpen;
        request.onerror?.();
        return;
      }
      const existing = this.databases.get(name);
      if (existing && existing.version > version) {
        request.error = new DOMException("The requested version is lower than the existing one.", "VersionError");
        request.onerror?.();
        return;
      }
      const record = existing ?? { version: 0, stores: new Map<string, Map<string, unknown>>() };
      this.databases.set(name, record);
      const db = new FakeDatabase(record.stores, this);
      request.result = db;
      if (record.version < version) {
        record.version = version;
        request.onupgradeneeded?.();
      }
      this.connections.push(db);
      request.onsuccess?.();
    });
    return request;
  }

  /** The next request of this kind fails with `error` and aborts its transaction. */
  failNext(operation: Operation, error: DOMException) {
    this.failures.push({ operation, error });
  }

  takeFailure(operation: Operation): DOMException | null {
    const index = this.failures.findIndex((failure) => failure.operation === operation);
    if (index === -1) return null;
    return this.failures.splice(index, 1)[0].error;
  }

  /** What another tab opening a newer version does to the open connections. */
  fireVersionChange() {
    for (const db of this.connections) if (!db.closed) db.onversionchange?.();
  }

  /** What iPadOS does to a page that sat in the background: the connection dies silently. */
  dropConnections() {
    for (const db of this.connections) db.closed = true;
  }

  /** The committed value, read without a transaction. */
  peek(database: string, store: string, key: string): unknown {
    return this.databases.get(database)?.stores.get(store)?.get(key);
  }

  asFactory(): IDBFactory {
    return this as unknown as IDBFactory;
  }
}
