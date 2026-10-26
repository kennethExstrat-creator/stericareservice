"use client";

// What New Inspection's Source Documents card holds until Create (docs/AI.md,
// "Reading order documents"). There is no inspection yet, so nothing goes to
// storage: the files stay in the browser, and Cancel or leaving the page
// drops them. Steri-AI reads the documents one at a time with readDocument,
// only while the form still needs its client, manufacturer, product type or
// product name (../_lib/sources.ts). On Create, handOver() gives every
// document to the page's upload queue as the new inspection's Source
// Documents, and the photos and videos to an Auto-Sort run for it: both
// belong to the page, not to this screen, so they carry on while the capture
// screen opens, where each document is read in full and Media shows the sort.
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { photoQueueStore } from "@/components/capture/photos/queue-store";
import { SOURCE_DOCUMENTS_KEY, mediaKind } from "@/lib/inspections/source-documents";
import { readableFile } from "@/lib/photos/readable";
import { spreadsheetTypeOf } from "@/lib/photos/sniff";
import type { DocumentFill, DocumentReadResult } from "@/lib/schemas/document-fill";
import { autoSort } from "../../[id]/_components/auto-sort";
import { readDocument } from "../actions";
import {
  documentRefusal,
  isPdf,
  mediaRefusal,
  mergeFills,
  nextToRead,
  readsHere,
  type DocumentRead,
  type HeldDocument,
  type HeldMedia,
  type ReadState,
} from "../_lib/sources";

const UNREACHABLE = "Could not reach the server. Check the connection, then try again.";

export type HeldSources = {
  documents: readonly HeldDocument[];
  media: readonly HeldMedia[];
  /** Documents being made ready: photos turned into JPEG. */
  preparing: number;
  /** Documents waiting are still read here; once the form has its values, they are read after Create. */
  canRead: boolean;
  /** The header values and order lines of the documents read, for Create. */
  fill: DocumentFill | null;
  addDocuments: (files: readonly File[]) => void;
  addMedia: (files: readonly File[]) => void;
  removeDocument: (key: string) => void;
  removeMedia: (key: string) => void;
  readAgain: (key: string) => void;
  /** On Create: the documents to the upload queue, the photos and videos to Auto-Sort, for the new inspection. */
  handOver: (inspectionId: string, userId: string) => Promise<void>;
};

/** One document to the reader; a call that never got an answer comes back as a message. */
async function readOne(file: File): Promise<DocumentReadResult> {
  try {
    const formData = new FormData();
    formData.append("document", file, file.name);
    return await readDocument(formData);
  } catch (error) {
    console.error(error);
    return { status: "error", message: UNREACHABLE };
  }
}

/**
 * A PDF typed as one; an Excel or CSV file typed as one too (Windows types
 * a CSV as Excel, and some browsers give a file no type), so the reader
 * takes it; a photo as 2048 px JPEG.
 */
async function holdable(file: File): Promise<File> {
  if (isPdf(file)) return file.type === "application/pdf" ? file : new File([file], file.name, { type: "application/pdf" });
  const spreadsheet = spreadsheetTypeOf(file);
  if (spreadsheet) return file.type === spreadsheet ? file : new File([file], file.name, { type: spreadsheet });
  return readableFile(file);
}

function notAdded(file: File, why: string) {
  toast.error(`${file.name || "The file"} was not added`, { description: why });
}

export function useHeldSources({
  needsValues,
  paused,
  onRead,
}: {
  /** The form still lacks its client, manufacturer, product type or product name: documents are read until it has them. */
  needsValues: boolean;
  /** Create is under way: nothing new is read or added. */
  paused: boolean;
  /** Fills the form's empty fields from a reading. */
  onRead: (read: DocumentRead) => void;
}): HeldSources {
  const [documents, setDocuments] = useState<readonly HeldDocument[]>([]);
  const [media, setMedia] = useState<readonly HeldMedia[]>([]);
  const [preparing, setPreparing] = useState(0);
  // The lists as last changed, for handOver() and the cleanup: state is for rendering.
  const held = useRef({ documents: [] as readonly HeldDocument[], media: [] as readonly HeldMedia[] });
  const counter = useRef(0);
  const preparation = useRef<Promise<void>>(Promise.resolve());
  const reading = useRef<string | null>(null);
  const mounted = useRef(false);
  const apply = useRef(onRead);
  useEffect(() => {
    apply.current = onRead;
  });

  const changeDocuments = useCallback((change: (current: readonly HeldDocument[]) => readonly HeldDocument[]) => {
    held.current.documents = change(held.current.documents);
    setDocuments(held.current.documents);
  }, []);

  const changeMedia = useCallback((change: (current: readonly HeldMedia[]) => readonly HeldMedia[]) => {
    held.current.media = change(held.current.media);
    setMedia(held.current.media);
  }, []);

  const setState = useCallback(
    (key: string, state: ReadState) =>
      changeDocuments((current) => current.map((document) => (document.key === key ? { ...document, state } : document))),
    [changeDocuments],
  );

  // Leaving the page drops the files and their preview links. Deferred: a development re-run of the
  // effects (Strict Mode, Fast Refresh) mounts again at once and keeps them.
  useEffect(() => {
    // The one object the lists live in: changes replace its fields, never the object.
    const lists = held.current;
    mounted.current = true;
    return () => {
      mounted.current = false;
      setTimeout(() => {
        if (mounted.current) return;
        for (const item of [...lists.documents, ...lists.media]) URL.revokeObjectURL(item.url);
      }, 0);
    };
  }, []);

  // One document at a time, while the form still needs values.
  const next = paused ? null : nextToRead(documents, needsValues);
  useEffect(() => {
    if (!next || reading.current !== null) return;
    const { key, file } = next;
    reading.current = key;
    queueMicrotask(() => setState(key, { step: "reading" }));
    void readOne(file).then((result) => {
      reading.current = null;
      // Removed meanwhile, or the page left: the answer goes nowhere.
      if (!mounted.current || !held.current.documents.some((document) => document.key === key)) return;
      if (result.status === "read") {
        apply.current(result);
        setState(key, { step: "read", read: result });
      } else {
        setState(key, { step: "failed", message: result.message });
      }
    });
  }, [next, setState]);

  const addDocuments = useCallback(
    (files: readonly File[]) => {
      const accepted = files.filter((file) => {
        const refusal = documentRefusal(file);
        if (refusal) notAdded(file, refusal);
        return refusal === null;
      });
      if (accepted.length === 0) return;
      setPreparing((count) => count + accepted.length);
      // One at a time, in the order chosen: photos are converted in memory.
      for (const file of accepted) {
        preparation.current = preparation.current.then(async () => {
          const ready = await holdable(file).catch(() => file);
          setPreparing((count) => count - 1);
          if (!mounted.current) return;
          const document: HeldDocument = {
            key: `document-${++counter.current}`,
            file: ready,
            url: URL.createObjectURL(ready),
            state: readsHere(ready) ? { step: "waiting" } : { step: "later" },
          };
          changeDocuments((current) => [...current, document]);
        });
      }
    },
    [changeDocuments],
  );

  const addMedia = useCallback(
    (files: readonly File[]) => {
      const added: HeldMedia[] = [];
      for (const file of files) {
        const refusal = mediaRefusal(file);
        if (refusal) notAdded(file, refusal);
        else added.push({ key: `media-${++counter.current}`, file, url: URL.createObjectURL(file), kind: mediaKind(file) ?? "photo" });
      }
      if (added.length > 0) changeMedia((current) => [...current, ...added]);
    },
    [changeMedia],
  );

  const removeDocument = useCallback(
    (key: string) => {
      const gone = held.current.documents.find((document) => document.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      changeDocuments((current) => current.filter((document) => document.key !== key));
    },
    [changeDocuments],
  );

  const removeMedia = useCallback(
    (key: string) => {
      const gone = held.current.media.find((item) => item.key === key);
      if (gone) URL.revokeObjectURL(gone.url);
      changeMedia((current) => current.filter((item) => item.key !== key));
    },
    [changeMedia],
  );

  const readAgain = useCallback((key: string) => setState(key, { step: "waiting" }), [setState]);

  const handOver = useCallback(async (inspectionId: string, userId: string) => {
    // A photo still being converted goes too.
    await preparation.current;
    const { documents: kept, media: taken } = held.current;
    void photoQueueStore.start(userId);
    // Documents first: they upload and are read while the photos are prepared.
    if (kept.length > 0) {
      void photoQueueStore.addFiles({
        inspectionId,
        moduleKey: SOURCE_DOCUMENTS_KEY,
        kind: "other",
        files: kept.map((document) => document.file),
      });
    }
    if (taken.length > 0) void autoSort(inspectionId, taken.map((item) => item.file));
  }, []);

  const reads = documents.flatMap((document) => (document.state.step === "read" ? [document.state.read] : []));
  return {
    documents,
    media,
    preparing,
    canRead: needsValues && !paused,
    fill: mergeFills(reads),
    addDocuments,
    addMedia,
    removeDocument,
    removeMedia,
    readAgain,
    handOver,
  };
}
