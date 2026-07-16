import { ref } from 'vue'

const ROOT_DIR = 'p2p-stream-recordings'

export function useOPFS() {
  const isSupported = ref(typeof StorageManager !== 'undefined' && 'getDirectory' in navigator.storage)
  const error = ref<string | null>(null)

  // Get root directory handle
  async function getRootDir(): Promise<FileSystemDirectoryHandle | null> {
    if (!isSupported.value) {
      error.value = 'Origin Private File System not supported'
      return null
    }

    try {
      const root = await navigator.storage.getDirectory()
      const dirHandle = await root.getDirectoryHandle(ROOT_DIR, { create: true })
      return dirHandle
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
      const campaignDir = await rootDir.getDirectoryHandle(campaignId, { create: true })
      return campaignDir
    } catch (err) {
      console.error('Failed to create campaign directory:', err)
      error.value = 'Failed to create campaign directory'
      return null
    }
  }

  // Write chunk to OPFS
  async function writeChunk(
    campaignId: string,
    recordingId: string,
    chunkIndex: number,
    blob: Blob
  ): Promise<string | null> {
    const campaignDir = await createCampaignDir(campaignId)
    if (!campaignDir) return null

    try {
      // Create recording subdirectory
      const recordingDir = await campaignDir.getDirectoryHandle(recordingId, { create: true })
      
      // Write chunk
      const fileName = `chunk-${chunkIndex.toString().padStart(6, '0')}.webm`
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

  // Read chunk from OPFS
  async function readChunk(
    campaignId: string,
    recordingId: string,
    chunkIndex: number
  ): Promise<Blob | null> {
    const campaignDir = await createCampaignDir(campaignId)
    if (!campaignDir) return null

    try {
      const recordingDir = await campaignDir.getDirectoryHandle(recordingId)
      const fileName = `chunk-${chunkIndex.toString().padStart(6, '0')}.webm`
      const fileHandle = await recordingDir.getFileHandle(fileName)
      const file = await fileHandle.getFile()
      return file.slice()
    } catch (err) {
      console.error('Failed to read chunk:', err)
      return null
    }
  }

  // Read all chunks for a recording
  async function readAllChunks(
    campaignId: string,
    recordingId: string
  ): Promise<Blob[]> {
    const campaignDir = await createCampaignDir(campaignId)
    if (!campaignDir) return []

    const chunks: Blob[] = []

    try {
      const recordingDir = await campaignDir.getDirectoryHandle(recordingId)
      
      // Iterate through all chunk files
      // @ts-ignore - TypeScript doesn't know about values() method yet
      for await (const entry of recordingDir.values()) {
        if (entry.kind === 'file' && entry.name.startsWith('chunk-')) {
          const fileHandle = await recordingDir.getFileHandle(entry.name)
          const file = await fileHandle.getFile()
          chunks.push(file.slice())
        }
      }

      // Sort chunks by index
      chunks.sort((a, b) => {
        const indexA = parseInt((a as any).name?.match(/chunk-(\d+)/)?.[1] || '0')
        const indexB = parseInt((b as any).name?.match(/chunk-(\d+)/)?.[1] || '0')
        return indexA - indexB
      })

    } catch (err) {
      console.error('Failed to read chunks:', err)
    }

    return chunks
  }

  // Delete recording
  async function deleteRecording(campaignId: string, recordingId: string): Promise<boolean> {
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
    if (!('storage' in navigator) || !('estimate' in navigator.storage)) {
      return null
    }

    try {
      const estimate = await navigator.storage.estimate()
      return {
        used: estimate.usage || 0,
        remaining: (estimate.quota || 0) - (estimate.usage || 0)
      }
    } catch (err) {
      console.error('Failed to get storage estimate:', err)
      return null
    }
  }

  // List all recordings
  async function listRecordings(): Promise<Array<{ campaignId: string; recordingId: string }>> {
    const rootDir = await getRootDir()
    if (!rootDir) return []

    const recordings: Array<{ campaignId: string; recordingId: string }> = []

    try {
      // @ts-ignore
      for await (const campaignEntry of rootDir.values()) {
        if (campaignEntry.kind === 'directory') {
          const campaignDir = await rootDir.getDirectoryHandle(campaignEntry.name)
          // @ts-ignore
          for await (const recordingEntry of campaignDir.values()) {
            if (recordingEntry.kind === 'directory') {
              recordings.push({
                campaignId: campaignEntry.name,
                recordingId: recordingEntry.name
              })
            }
          }
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
    deleteRecording,
    getStorageUsage,
    listRecordings
  }
}
