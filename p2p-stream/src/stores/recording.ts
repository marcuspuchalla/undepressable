import { defineStore } from "pinia";
import { ref } from "vue";
import type { Recording } from "../types";

// Persistence/listing layer for saved recordings. The actual capture pipeline
// (MediaRecorder + OPFS + integrity proof) lives in composables/useRecording.ts,
// which writes metadata to the same IndexedDB store this reads back.

const DB_NAME = "P2PStreamRecordings";
const DB_VERSION = 1;
const STORE_NAME = "recordings";

function initDB(): Promise<IDBDatabase> {
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

export const useRecordingStore = defineStore("recording", () => {
  const recordings = ref<Recording[]>([]);

  // Load all saved recordings, rehydrating Date fields from their ISO strings.
  async function loadRecordings() {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => {
        recordings.value = request.result.map((r: any) => ({
          ...r,
          startedAt: new Date(r.startedAt),
          endedAt: r.endedAt ? new Date(r.endedAt) : undefined,
          chunks: r.chunks?.map((c: any) => ({ ...c, timestamp: new Date(c.timestamp) })) || [],
        }));
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  async function deleteRecording(recordingId: string) {
    const db = await initDB();
    return new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(recordingId);
      request.onsuccess = () => {
        recordings.value = recordings.value.filter((r) => r.id !== recordingId);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  return { recordings, loadRecordings, deleteRecording };
});
