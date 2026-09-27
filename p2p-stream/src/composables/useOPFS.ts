import { ref } from 'vue'

const ROOT_DIR = 'p2p-stream-recordings'

// Recording chunks live in the Origin Private File System where the browser
// offers it. Where it does not — the portable single-file app opened from disk
// (file:// has no OPFS), older browsers — they go to IndexedDB instead, with
// the same layout, so recordings, verification and transfers work either way.
type Backend = 'opfs' | 'idb' | 'none'
let backendPromise: Promise<Backend> | null = null

function backend(): Promise<Backend> {
  backendPromise ??= (async (): Promise<Backend> => {
    try {
      if (typeof navigator !== 'undefined' && navigator.storage && 'getDirectory' in navigator.storage) {
        await navigator.storage.getDirectory()
        return 'opfs'
      }
    } catch {
      /* e.g. SecurityError on file:// */
    }
    return typeof indexedDB !== 'undefined' ? 'idb' : 'none'
  })()
  return backendPromise
}

// --- IndexedDB fallback: one store, keys "campaign/recording/000042" ---

const IDB_NAME = 'P2PStreamChunks'
const IDB_STORE = 'chunks'
let idbPromise: Promise<IDBDatabase> | null = null

function idb(): Promise<IDBDatabase> {
  idbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return idbPromise
}

function idbRequest<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return idb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(db.transaction(IDB_STORE, mode).objectStore(IDB_STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

const chunkName = (index: number) => `chunk-${index.toString().padStart(6, '0')}.webm`
const idbKey = (campaignId: string, recordingId: string, index: number) => `${campaignId}/${recordingId}/${index.toString().padStart(6, '0')}`
const idbRange = (campaignId: string, recordingId: string) => IDBKeyRange.bound(`${campaignId}/${recordingId}/`, `${campaignId}/${recordingId}/￿`)

export function useOPFS() {
  const isSupported = ref(typeof indexedDB !== 'undefined' || (typeof StorageManager !== 'undefined' && 'getDirectory' in navigator.storage))
  const error = ref<string | null>(null)

  // Get root directory handle
  async function getRootDir(): Promise<FileSystemDirectoryHandle | null> {
    if ((await backend()) !== 'opfs') return null
    try {
      const root = await navigator.storage.getDirectory()
      return await root.getDirectoryHandle(ROOT_DIR, { create: true })
    } catch (err) {
      console.error('Failed to get OPFS root directory:', err)
      error.value = 'Failed to access file system'
      return null
    }
  }

  // Create campaign directory
  async function createCampaignDir(campaignId: string): Promise<FileSystemDirectoryHandle | null> {
    const rootDir = await getRootDir()
    if (!rootDir) return null
    try {
      return await rootDir.getDirectoryHandle(campaignId, { create: true })
    } catch (err) {
      console.error('Failed to create campaign directory:', err)
      error.value = 'Failed to create campaign directory'
      return null
    }
  }

  // Write chunk
  async function writeChunk(campaignId: string, recordingId: string, chunkIndex: number, blob: Blob): Promise<string | null> {
    const kind = await backend()
    if (kind === 'idb') {
      try {
        await idbRequest('readwrite', (s) => s.put(blob, idbKey(campaignId, recordingId, chunkIndex)))
        return `idb:${idbKey(campaignId, recordingId, chunkIndex)}`
      } catch (err) {
        console.error('Failed to write chunk:', err)
        error.value = 'Failed to write chunk'
        return null
      }
    }
    const campaignDir = await createCampaignDir(campaignId)
    if (!campaignDir) return null
    try {
      const recordingDir = await campaignDir.getDirectoryHandle(recordingId, { create: true })
      const fileName = chunkName(chunkIndex)
      const fileHandle = await recordingDir.getFileHandle(fileName, { create: true })
      const writable = await fileHandle.createWritable()
      await writable.write(blob)
      await writable.close()
      return `${ROOT_DIR}/${campaignId}/${recordingId}/${fileName}`
    } catch (err) {
      console.error('Failed to write chunk:', err)
      error.value = 'Failed to write chunk'
      return null
    }
  }

  // Read one chunk
  async function readChunk(campaignId: string, recordingId: string, chunkIndex: number): Promise<Blob | null> {
    if ((await backend()) === 'idb') {
      try {
        return ((await idbRequest('readonly', (s) => s.get(idbKey(campaignId, recordingId, chunkIndex)))) as Blob | undefined) ?? null
      } catch {
        return null
      }
    }
    const campaignDir = await createCampaignDir(campaignId)
    if (!campaignDir) return null
    try {
      const recordingDir = await campaignDir.getDirectoryHandle(recordingId)
      const fileHandle = await recordingDir.getFileHandle(chunkName(chunkIndex))
      return await fileHandle.getFile()
    } catch (err) {
      console.error('Failed to read chunk:', err)
      return null
    }
  }

  // Indexes of the chunks stored for a recording, ascending.
  async function listChunkIndexes(campaignId: string, recordingId: string): Promise<number[]> {
    if ((await backend()) === 'idb') {
      try {
        const keys = (await idbRequest('readonly', (s) => s.getAllKeys(idbRange(campaignId, recordingId)))) as string[]
        return keys.map((k) => Number(k.slice(k.lastIndexOf('/') + 1))).sort((a, b) => a - b)
      } catch {
        return []
      }
    }
    const campaignDir = await createCampaignDir(campaignId)
    if (!campaignDir) return []
    const out: number[] = []
    try {
      const recordingDir = await campaignDir.getDirectoryHandle(recordingId)
      // @ts-ignore
      for await (const entry of recordingDir.values()) {
        const m = entry.kind === 'file' ? /^chunk-(\d+)\.webm$/.exec(entry.name) : null
        if (m) out.push(Number(m[1]))
      }
    } catch {
      /* no directory yet */
    }
    return out.sort((a, b) => a - b)
  }

  // All chunks of a recording, in recording order. (Directory iteration order
  // is unspecified, and a Blob read back from a file has no name to sort by.)
  async function readAllChunks(campaignId: string, recordingId: string): Promise<Blob[]> {
    const chunks: Blob[] = []
    for (const index of await listChunkIndexes(campaignId, recordingId)) {
      const blob = await readChunk(campaignId, recordingId, index)
      if (blob) chunks.push(blob)
    }
    return chunks
  }

  // Delete recording
  async function deleteRecording(campaignId: string, recordingId: string): Promise<boolean> {
    if ((await backend()) === 'idb') {
      try {
        await idbRequest('readwrite', (s) => s.delete(idbRange(campaignId, recordingId)))
        return true
      } catch {
        return false
      }
    }
    const rootDir = await getRootDir()
    if (!rootDir) return false
    try {
      const campaignDir = await rootDir.getDirectoryHandle(campaignId)
      await campaignDir.removeEntry(recordingId, { recursive: true })
      return true
    } catch (err) {
      console.error('Failed to delete recording:', err)
      return false
    }
  }

  // Get storage usage
  async function getStorageUsage(): Promise<{ used: number; remaining: number } | null> {
    if (!('storage' in navigator) || !('estimate' in navigator.storage)) return null
    try {
      const estimate = await navigator.storage.estimate()
      return { used: estimate.usage || 0, remaining: (estimate.quota || 0) - (estimate.usage || 0) }
    } catch (err) {
      console.error('Failed to get storage estimate:', err)
      return null
    }
  }

  // List all recordings
  async function listRecordings(): Promise<Array<{ campaignId: string; recordingId: string }>> {
    if ((await backend()) === 'idb') {
      const keys = ((await idbRequest('readonly', (s) => s.getAllKeys()).catch(() => [])) as string[]) ?? []
      const seen = new Map<string, { campaignId: string; recordingId: string }>()
      for (const k of keys) {
        const [campaignId, recordingId] = k.split('/')
        seen.set(`${campaignId}/${recordingId}`, { campaignId, recordingId })
      }
      return [...seen.values()]
    }
    const rootDir = await getRootDir()
    if (!rootDir) return []
    const recordings: Array<{ campaignId: string; recordingId: string }> = []
    try {
      // @ts-ignore
      for await (const campaignEntry of rootDir.values()) {
        if (campaignEntry.kind !== 'directory') continue
        const campaignDir = await rootDir.getDirectoryHandle(campaignEntry.name)
        // @ts-ignore
        for await (const recordingEntry of campaignDir.values()) {
          if (recordingEntry.kind === 'directory') recordings.push({ campaignId: campaignEntry.name, recordingId: recordingEntry.name })
        }
      }
    } catch (err) {
      console.error('Failed to list recordings:', err)
    }
    return recordings
  }

  return {
    isSupported,
    error,
    getRootDir,
    createCampaignDir,
    writeChunk,
    readChunk,
    readAllChunks,
    listChunkIndexes,
    deleteRecording,
    getStorageUsage,
    listRecordings,
  }
}
