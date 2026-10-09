import type { Recording } from "../types";

// Recording metadata lives in IndexedDB; the footage itself in OPFS
// (composables/useOPFS.ts). One module so the recorder, the list, imports and
// home sync all read and write the same shape.

const DB_NAME = "P2PStreamRecordings";
const DB_VERSION = 1;
const STORE_NAME = "recordings";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
  });
}

// Plain JSON copies: records often come from reactive state (Vue proxies),
// which IndexedDB's structured clone refuses ("could not be cloned").
const plain = <T>(x: T): T => JSON.parse(JSON.stringify(x))

export function serializeRecording(recording: Recording): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: recording.id,
    campaignId: recording.campaignId,
    recordedBy: recording.recordedBy,
    startedAt: recording.startedAt.toISOString(),
    status: recording.status,
    metadata: plain(recording.metadata),
    chunks: recording.chunks.map((c) => ({
      index: c.index,
      timestamp: c.timestamp.toISOString(),
      duration: c.duration,
      size: c.size,
      opfsPath: c.opfsPath,
      checksum: c.checksum,
    })),
  };
  if (recording.endedAt) out.endedAt = recording.endedAt.toISOString();
  if (recording.proof) out.proof = plain(recording.proof);
  if (recording.origin) out.origin = plain(recording.origin);
  if (recording.sealed) out.sealed = plain(recording.sealed);
  if (recording.timestamp) out.timestamp = plain(recording.timestamp);
  if (recording.attestations?.length) out.attestations = plain(recording.attestations);
  if (recording.corroboration) out.corroboration = plain(recording.corroboration);
  if (recording.combined) out.combined = plain(recording.combined);
  return out;
}

export function deserializeRecording(r: any): Recording {
  return {
    ...r,
    startedAt: new Date(r.startedAt),
    endedAt: r.endedAt ? new Date(r.endedAt) : undefined,
    chunks: r.chunks?.map((c: any) => ({ ...c, timestamp: new Date(c.timestamp) })) || [],
  };
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = fn(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function putRecording(recording: Recording): Promise<void> {
  await run("readwrite", (s) => s.put(serializeRecording(recording)));
}

export async function getRecording(id: string): Promise<Recording | null> {
  const r = await run("readonly", (s) => s.get(id));
  return r ? deserializeRecording(r) : null;
}

export async function getAllRecordings(): Promise<Recording[]> {
  const all = await run("readonly", (s) => s.getAll());
  return all.map(deserializeRecording);
}

export async function deleteRecordingMeta(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}
