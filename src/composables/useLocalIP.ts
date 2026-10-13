import { ref, onMounted } from 'vue'

export function useLocalIP() {
  const localIP = ref<string>('')
  const isLocalhost = ref(false)

  function detectIP() {
    // Check if we're on localhost
    const hostname = window.location.hostname
    isLocalhost.value = hostname === 'localhost' || hostname === '127.0.0.1'

    if (!isLocalhost.value) {
      // Already using an IP or domain
      localIP.value = hostname
      return
    }

    // Try to get local IP via WebRTC (works in most browsers)
    try {
      const pc = new RTCPeerConnection({
        iceServers: []
      })
      
      pc.createDataChannel('')
      
      pc.createOffer().then(offer => pc.setLocalDescription(offer))
      
      pc.onicecandidate = (ice) => {
        if (!ice || !ice.candidate || !ice.candidate.candidate) {
          return
        }
        
        // Parse IP from ICE candidate
        const ipMatch = ice.candidate.candidate.match(/([0-9]{1,3}\.){3}[0-9]{1,3}/)
        if (ipMatch && ipMatch[0]) {
          const ip = ipMatch[0]
          // Filter out common non-local IPs
          if (!ip.startsWith('0.') && !ip.startsWith('127.')) {
            localIP.value = ip
            pc.close()
          }
        }
      }

      // Timeout fallback
      setTimeout(() => {
        if (!localIP.value) {
          pc.close()
        }
      }, 1000)
      
    } catch (e) {
      console.log('Could not detect local IP via WebRTC')
    }
  }

  function getShareUrl(): string {
    const protocol = window.location.protocol
    const port = window.location.port
    
    if (isLocalhost.value && localIP.value) {
      // Replace localhost with actual IP
      const portStr = port ? `:${port}` : ''
      return `${protocol}//${localIP.value}${portStr}`
    }
    
    // Return current origin
    return window.location.origin
  }

  onMounted(() => {
    detectIP()
  })

  return {
    localIP,
    isLocalhost,
    getShareUrl,
    detectIP
  }
}
