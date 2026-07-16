import { ref } from 'vue'
import jsQR from 'jsqr'

export function useQRScanner() {
  const isScanning = ref(false)
  const error = ref<string | null>(null)
  let videoStream: MediaStream | null = null
  let animationFrame: number | null = null

  // Check if camera is supported
  function isCameraSupported(): boolean {
    if (typeof window === 'undefined') return false
    if (!navigator.mediaDevices) return false
    if (!navigator.mediaDevices.getUserMedia) return false
    return true
  }

  // Check if running on HTTPS (required for camera on iOS)
  function isSecureContext(): boolean {
    return window.isSecureContext || 
           location.protocol === 'https:' || 
           location.hostname === 'localhost' ||
           location.hostname === '127.0.0.1'
  }

  async function startScanning(
    videoEl: HTMLVideoElement,
    canvasEl: HTMLCanvasElement,
    onDetect: (data: string) => void,
    preferredCamera: 'environment' | 'user' = 'environment'
  ): Promise<boolean> {
    try {
      // Clear any previous error
      error.value = null
      
      // Check prerequisites
      if (!isCameraSupported()) {
        error.value = 'Camera not supported. Please use a modern browser with camera access.'
        console.error('[QRScanner] Camera not supported - mediaDevices:', !!navigator.mediaDevices)
        return false
      }

      if (!isSecureContext()) {
        error.value = 'Camera requires HTTPS. Please use a secure connection or localhost.'
        console.error('[QRScanner] Not in secure context')
        return false
      }

      isScanning.value = true

      // Try to get camera with preferred facing mode
      let constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: preferredCamera },
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      }

      try {
        videoStream = await navigator.mediaDevices.getUserMedia(constraints)
      } catch (err: any) {
        console.warn('[QRScanner] Failed with preferred camera, trying any camera:', err.message)
        
        // Fallback: try any camera
        constraints = {
          video: true,
          audio: false
        }
        videoStream = await navigator.mediaDevices.getUserMedia(constraints)
      }

      if (!videoStream) {
        throw new Error('Failed to get video stream')
      }

      // Set up video element
      videoEl.srcObject = videoStream
      
      // Wait for video to be ready
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Video play timeout'))
        }, 10000)
        
        videoEl.onloadedmetadata = () => {
          clearTimeout(timeout)
          resolve()
        }
        
        videoEl.onerror = () => {
          clearTimeout(timeout)
          reject(new Error('Video element error'))
        }
        
        videoEl.play().catch(reject)
      })

      const ctx = canvasEl.getContext('2d', { willReadFrequently: true })
      if (!ctx) {
        throw new Error('Could not get canvas context')
      }

      // Scan loop
      const scan = () => {
        if (!isScanning.value) return

        if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA && videoEl.videoWidth > 0) {
          // Match canvas size to video
          if (canvasEl.width !== videoEl.videoWidth || canvasEl.height !== videoEl.videoHeight) {
            canvasEl.width = videoEl.videoWidth
            canvasEl.height = videoEl.videoHeight
          }
          
          ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height)
          
          const imageData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height)
          
          try {
            const code = jsQR(imageData.data, imageData.width, imageData.height, {
              inversionAttempts: 'attemptBoth'
            })

            if (code?.data) {
              console.log('[QRScanner] Code detected:', code.data)
              onDetect(code.data)
              stopScanning()
              return
            }
          } catch (err) {
            // jsQR errors are usually benign (no QR found)
          }
        }

        animationFrame = requestAnimationFrame(scan)
      }

      scan()
      return true

    } catch (err: any) {
      console.error('[QRScanner] Error:', err)
      
      // Provide user-friendly error messages
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        error.value = 'Camera permission denied. Please allow camera access in your browser settings.'
      } else if (err.name === 'NotFoundError') {
        error.value = 'No camera found. Please ensure your device has a camera.'
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        error.value = 'Camera is in use by another app. Please close other camera apps.'
      } else if (err.name === 'OverconstrainedError') {
        error.value = 'Camera constraints not supported. Trying fallback...'
        // Try again with simpler constraints
        return startScanning(videoEl, canvasEl, onDetect, 'user')
      } else {
        error.value = err.message || 'Failed to start camera'
      }
      
      isScanning.value = false
      return false
    }
  }

  function stopScanning() {
    isScanning.value = false
    
    if (animationFrame) {
      cancelAnimationFrame(animationFrame)
      animationFrame = null
    }
    
    if (videoStream) {
      videoStream.getTracks().forEach(track => {
        track.stop()
      })
      videoStream = null
    }
  }

  // Get available cameras
  async function getCameras(): Promise<MediaDeviceInfo[]> {
    try {
      if (!isCameraSupported()) {
        console.warn('[QRScanner] getCameras: Camera not supported')
        return []
      }
      
      // First request permission to get labeled devices
      const stream = await navigator.mediaDevices.getUserMedia({ video: true })
      stream.getTracks().forEach(track => track.stop())
      
      const devices = await navigator.mediaDevices.enumerateDevices()
      const cameras = devices.filter(d => d.kind === 'videoinput')
      
      console.log('[QRScanner] Found cameras:', cameras.length)
      return cameras
    } catch (err) {
      console.error('[QRScanner] Failed to get cameras:', err)
      return []
    }
  }

  return {
    isScanning,
    error,
    isCameraSupported,
    isSecureContext,
    startScanning,
    stopScanning,
    getCameras
  }
}
