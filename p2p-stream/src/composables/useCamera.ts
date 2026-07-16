import { ref, computed } from 'vue'

export function useCamera() {
  const stream = ref<MediaStream | null>(null)
  const isLoading = ref(false)
  const error = ref<string | null>(null)
  const availableCameras = ref<MediaDeviceInfo[]>([])
  const selectedCameraId = ref<string>('')

  const hasPermission = computed(() => stream.value !== null)

  // Get available cameras
  async function enumerateCameras() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      availableCameras.value = devices.filter(d => d.kind === 'videoinput')
      
      if (availableCameras.value.length > 0 && !selectedCameraId.value) {
        selectedCameraId.value = availableCameras.value[0].deviceId
      }
    } catch (err) {
      console.error('Failed to enumerate cameras:', err)
    }
  }

  // Request camera access
  async function startCamera(
    videoQuality: string = '720p',
    audio: boolean = true
  ): Promise<MediaStream | null> {
    isLoading.value = true
    error.value = null

    try {
      const constraints: MediaStreamConstraints = {
        video: {
          deviceId: selectedCameraId.value ? { exact: selectedCameraId.value } : undefined,
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: audio ? {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: 44100
        } : false
      }

      // Adjust constraints based on quality
      switch (videoQuality) {
        case '480p':
          constraints.video = {
            ...constraints.video as MediaTrackConstraints,
            width: { ideal: 854 },
            height: { ideal: 480 }
          }
          break
        case '360p':
          constraints.video = {
            ...constraints.video as MediaTrackConstraints,
            width: { ideal: 640 },
            height: { ideal: 360 }
          }
          break
        case '240p':
          constraints.video = {
            ...constraints.video as MediaTrackConstraints,
            width: { ideal: 426 },
            height: { ideal: 240 }
          }
          break
      }

      stream.value = await navigator.mediaDevices.getUserMedia(constraints)
      
      // Enumerate cameras after getting permission
      await enumerateCameras()
      
      return stream.value
    } catch (err) {
      console.error('Camera access error:', err)
      
      if (err instanceof DOMException) {
        switch (err.name) {
          case 'NotAllowedError':
            error.value = 'Camera permission denied. Please allow camera access in your browser settings.'
            break
          case 'NotFoundError':
            error.value = 'No camera found. Please connect a camera and try again.'
            break
          case 'NotReadableError':
            error.value = 'Camera is in use by another application.'
            break
          default:
            error.value = `Camera error: ${err.message}`
        }
      } else {
        error.value = 'Failed to access camera'
      }
      
      return null
    } finally {
      isLoading.value = false
    }
  }

  // Stop camera
  function stopCamera() {
    if (stream.value) {
      stream.value.getTracks().forEach(track => {
        track.stop()
      })
      stream.value = null
    }
  }

  // Switch camera
  async function switchCamera(deviceId: string): Promise<MediaStream | null> {
    selectedCameraId.value = deviceId
    stopCamera()
    return await startCamera()
  }

  // Toggle audio
  function toggleAudio(enabled: boolean) {
    if (stream.value) {
      stream.value.getAudioTracks().forEach(track => {
        track.enabled = enabled
      })
    }
  }

  // Toggle video
  function toggleVideo(enabled: boolean) {
    if (stream.value) {
      stream.value.getVideoTracks().forEach(track => {
        track.enabled = enabled
      })
    }
  }

  return {
    stream,
    isLoading,
    error,
    hasPermission,
    availableCameras,
    selectedCameraId,
    startCamera,
    stopCamera,
    switchCamera,
    toggleAudio,
    toggleVideo,
    enumerateCameras
  }
}
