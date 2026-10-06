// Client-side persistence for capture (BUILD_SPEC 8, docs/OFFLINE.md):
// autosave with a local IndexedDB copy. Framework-agnostic; the capture
// screen wires it to React with useSyncExternalStore.
export {
  createAutosave,
  AUTOSAVE_DEBOUNCE_MS,
  AUTOSAVE_MAX_WAIT_MS,
  AUTOSAVE_REQUEST_TIMEOUT_MS,
  AUTOSAVE_FLUSH_TIMEOUT_MS,
  CONFLICT_MESSAGE,
  STORAGE_MESSAGE,
  type AutosaveController,
  type AutosaveOptions,
  type AutosaveSnapshot,
  type AutosaveStatus,
  type AutosaveError,
  type AutosaveErrorReason,
  type AutosaveConflict,
  type StartResult,
  type FlushResult,
} from "./autosave";
export {
  saveRequestSchema,
  saveOutcomeSchema,
  type AutosaveTransport,
  type SaveOutcome,
  type SaveRequest,
  type ServerCopy,
} from "./protocol";
export {
  saveInspectionData,
  supabaseAutosaveTransport,
  type MirroredColumns,
  type SaveInspectionOptions,
} from "./supabase-transport";
export {
  reconcile,
  draftKey,
  findUnsavedDraft,
  discardDraft,
  listUnsavedDrafts,
  pruneSyncedDrafts,
  type LocalDraft,
  type Reconciliation,
} from "./drafts";
export {
  openOfflineDatabase,
  getOfflineDatabase,
  requestPersistentStorage,
  OFFLINE_DB_NAME,
  OFFLINE_DB_VERSION,
  OFFLINE_STORES,
  type OfflineDatabase,
  type OfflineStoreName,
} from "./db";
export { createMemoryDatabase, createMemoryStore, type KeyValueDatabase, type KeyValueStore } from "./kv";
export { openIndexedDb, type IndexedDatabase, type IndexedDbOptions } from "./idb";
export {
  browserConnectivity,
  manualConnectivity,
  defaultConnectivity,
  browserLifecycle,
  defaultLifecycle,
  noLifecycle,
  type Connectivity,
  type ManualConnectivity,
  type PageLifecycle,
} from "./connectivity";
export { FAILURE_MESSAGES, FAILURE_REASONS, isRetryable, type Failure, type FailureReason } from "./failures";
export { AUTOSAVE_BACKOFF, UPLOAD_BACKOFF, type Backoff } from "./backoff";
export { newId } from "./id";
