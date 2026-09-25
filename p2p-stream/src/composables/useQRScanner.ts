import { ref } from 'vue'
import jsQR from 'jsqr'

// Build a native BarcodeDetector limited to QR, or null if unavailable/unusable.
async function createNativeDetector(): Promise<{ detect: (src: CanvasImageSource) => Promise<any[]> } | null> {
  const BD = (globalThis as any).BarcodeDetector
  if (!BD) return null
  try {
    const formats: string[] | undefined = await BD.getSupportedFormats?.()
    if (formats && !formats.includes('qr_code')) return null
    return new BD({ formats: ['qr_code'] })
  } catch {
    return null
  }
}

export function useQRScanner() {
  const isScanning = ref(false)
  const error = ref<string | null>(null)
  let videoStream: MediaStream | null = null
  let ownsStream = true
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
    preferredCamera: 'environment' | 'user' = 'environment',
    // Scan frames of a stream that is already open — the one being broadcast.
    // Phones often cannot open a second camera while one is streaming, and
    // stopping the scan must not stop the broadcast.
    existingStream?: MediaStream
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
      ownsStream = !existingStream

      if (existingStream) {
        videoStream = existingStream
      } else {
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

      // Prefer the native BarcodeDetector where the browser has it (Android /
      // desktop Chromium): it's hardware-accelerated and far more robust than a
      // JS decoder. iOS Safari has no BarcodeDetector, so we fall back to jsQR —
      // which is what keeps iPhone scanning working.
      const nativeDetector = await createNativeDetector()
      console.log(`[QRScanner] Using ${nativeDetector ? 'native BarcodeDetector' : 'jsQR fallback'}`)

      let detecting = false
      const handleHit = (value: string) => {
        console.log('[QRScanner] Code detected:', value)
        onDetect(value)
        stopScanning()
      }

      const scan = () => {
        if (!isScanning.value) return

        if (videoEl.readyState === videoEl.HAVE_ENOUGH_DATA && videoEl.videoWidth > 0) {
          if (nativeDetector) {
            // Native detect() is async; guard against overlapping calls.
            if (!detecting) {
              detecting = true
              nativeDetector
                .detect(videoEl)
                .then((codes: any[]) => {
                  const value = codes?.[0]?.rawValue
                  if (value && isScanning.value) handleHit(value)
                })
                .catch(() => {})
                .finally(() => {
                  detecting = false
                })
            }
          } else {
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
                handleHit(code.data)
                return
              }
            } catch (err) {
              // jsQR throws on some frames; benign (just no QR this frame)
            }
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
    
    if (videoStream && ownsStream) {
      videoStream.getTracks().forEach(track => {
        track.stop()
      })
    }
    videoStream = null
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
