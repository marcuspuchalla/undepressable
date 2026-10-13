import { defineStore } from "pinia";
import { ref } from "vue";
import type { Recording } from "../types";
import { getAllRecordings, deleteRecordingMeta } from "../lib/recordingDb";

// Listing layer for saved recordings. The capture pipeline (MediaRecorder +
// OPFS + integrity proof) lives in composables/useRecording.ts; metadata goes
// through lib/recordingDb.ts.

export const useRecordingStore = defineStore("recording", () => {
  const recordings = ref<Recording[]>([]);

  async function loadRecordings() {
    const all = await getAllRecordings();
    recordings.value = all.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  }

  async function deleteRecording(recordingId: string) {
    await deleteRecordingMeta(recordingId);
    recordings.value = recordings.value.filter((r) => r.id !== recordingId);
  }

  return { recordings, loadRecordings, deleteRecording };
});
