import { ref, computed, markRaw } from 'vue'
import type { PeerInfo, UserRole } from '../types'

// Trystero strategies - lazy loaded
let joinRoomTorrent: any = null
let joinRoomNostr: any = null

export type TrysteroStrategy = 'torrent' | 'nostr' | 'both'

export interface TrysteroRoom {
  selfId: string
  onPeerJoin: (callback: (peerId: string) => void) => void
  onPeerLeave: (callback: (peerId: string) => void) => void
  onPeerStream: (callback: (stream: MediaStream, peerId: string) => void) => void
  addStream: (stream: MediaStream, peerId?: string) => void
  removeStream: (stream: MediaStream, peerId?: string) => void
  leave: () => void
}

export function useTrystero() {
  const rooms = ref<Map<TrysteroStrategy, TrysteroRoom>>(new Map())
  const peers = ref<Map<string, PeerInfo>>(new Map())
  const localStream = ref<MediaStream | null>(null)
  const isConnecting = ref(false)
  const error = ref<string | null>(null)
  const selfId = ref<string>('')
  const activeStrategies = ref<TrysteroStrategy[]>([])
  const isReady = ref(false)

  const peerCount = computed(() => peers.value.size)
  const isConnected = computed(() => peerCount.value > 0)
  const peerList = computed(() => Array.from(peers.value.values()))

  // Lazy load strategy modules
  async function loadStrategy(strategy: 'torrent' | 'nostr') {
    if (strategy === 'torrent' && !joinRoomTorrent) {
      const mod = await import('trystero/torrent')
      joinRoomTorrent = mod.joinRoom
    } else if (strategy === 'nostr' && !joinRoomNostr) {
      const mod = await import('trystero/nostr')
      joinRoomNostr = mod.joinRoom
    }
  }

  // Initialize Trystero strategies
  async function init(strategies: TrysteroStrategy[]): Promise<boolean> {
    try {
      activeStrategies.value = strategies
      
      if (strategies.includes('torrent') || strategies.includes('both')) {
        await loadStrategy('torrent')
      }
      if (strategies.includes('nostr') || strategies.includes('both')) {
        await loadStrategy('nostr')
      }
      
      isReady.value = true
      return true
    } catch (err: any) {
      error.value = `Failed to load strategies: ${err.message}`
      return false
    }
  }

  // Create rooms with selected strategies
  async function createRoom(
    campaignId: string,
    strategies: TrysteroStrategy[],
    stream?: MediaStream
  ): Promise<boolean> {
    error.value = null
    isConnecting.value = true

    try {
      // Leave existing rooms
      leaveAllRooms()

      const strategiesToUse = strategies.includes('both') 
        ? ['torrent', 'nostr'] as const
        : strategies.filter(s => s !== 'both') as ('torrent' | 'nostr')[]

      // Create rooms for each strategy
      for (const strategy of strategiesToUse) {
        const joinRoom = strategy === 'nostr' ? joinRoomNostr : joinRoomTorrent
        
        const room = joinRoom(
          { appId: 'p2p-es-v1' },
          campaignId
        )

        rooms.value.set(strategy, markRaw(room))
        
        if (!selfId.value) {
          selfId.value = room.selfId
        }

        // Set up event handlers
        setupRoomHandlers(room, 'streamer', stream)
        
        console.log(`[Trystero] Created ${strategy} room for:`, campaignId)
      }

      isConnecting.value = false
      return true
    } catch (err: any) {
      error.value = err.message || 'Failed to create room'
      isConnecting.value = false
      return false
    }
  }

  // Join rooms with selected strategies
  async function joinRoom(
    campaignId: string,
    strategies: TrysteroStrategy[]
  ): Promise<boolean> {
    error.value = null
    isConnecting.value = true

    try {
      // Leave existing rooms
      leaveAllRooms()

      const strategiesToUse = strategies.includes('both') 
        ? ['torrent', 'nostr'] as const
        : strategies.filter(s => s !== 'both') as ('torrent' | 'nostr')[]

      // Join rooms for each strategy
      for (const strategy of strategiesToUse) {
        const joinRoomFn = strategy === 'nostr' ? joinRoomNostr : joinRoomTorrent
        
        const room = joinRoomFn(
          { appId: 'p2p-es-v1' },
          campaignId
        )

        rooms.value.set(strategy, markRaw(room))
        
        if (!selfId.value) {
          selfId.value = room.selfId
        }

        // Set up event handlers
        setupRoomHandlers(room, 'collector')
        
        console.log(`[Trystero] Joined ${strategy} room:`, campaignId)
      }

      isConnecting.value = false
      return true
    } catch (err: any) {
      error.value = err.message || 'Failed to join room'
      isConnecting.value = false
      return false
    }
  }

  // Set up room event handlers
  function setupRoomHandlers(
    roomInstance: TrysteroRoom,
    role: UserRole,
    stream?: MediaStream
  ) {
    // Handle peers joining
    roomInstance.onPeerJoin((peerId: string) => {
      console.log(`[Trystero] Peer joined: ${peerId}`)
      
      if (!peers.value.has(peerId)) {
        peers.value.set(peerId, {
          id: peerId,
          displayName: `${role === 'streamer' ? 'Collector' : 'Streamer'} ${peerId.slice(0, 6)}`,
          role: role === 'streamer' ? 'collector' : 'streamer',
          connectionState: 'connected',
          joinedAt: new Date()
        })
      }

      // If we're the streamer, send our stream to the new peer
      if (role === 'streamer' && stream) {
        console.log(`[Trystero] Sending stream to ${peerId}`)
        roomInstance.addStream(stream, peerId)
      }
    })

    // Handle peers leaving
    roomInstance.onPeerLeave((peerId: string) => {
      console.log(`[Trystero] Peer left: ${peerId}`)
      peers.value.delete(peerId)
    })

    // Handle incoming streams
    roomInstance.onPeerStream((receivedStream: MediaStream, peerId: string) => {
      console.log(`[Trystero] Received stream from ${peerId}`)
      onStreamReceived.value?.(receivedStream, peerId)
    })
  }

  // Callback for when stream is received
  const onStreamReceived = ref<((stream: MediaStream, peerId: string) => void) | null>(null)

  function setOnStreamReceived(callback: (stream: MediaStream, peerId: string) => void) {
    onStreamReceived.value = callback
  }

  // Update local stream
  function updateStream(stream: MediaStream | null) {
    localStream.value = stream
    
    if (stream) {
      // Send stream to all peers in all rooms
      rooms.value.forEach((room) => {
        peers.value.forEach((peer) => {
          room.addStream(stream, peer.id)
        })
      })
    }
  }

  // Leave all rooms
  function leaveAllRooms() {
    rooms.value.forEach((room) => {
      room.leave()
    })
    rooms.value.clear()
    peers.value.clear()
    selfId.value = ''
  }

  // Leave rooms
  function leaveRoom() {
    leaveAllRooms()
  }

  // Get connection status for each strategy
  function getStrategyStatus(): { strategy: string; connected: boolean; peers: number }[] {
    return Array.from(rooms.value.keys()).map(strategy => ({
      strategy,
      connected: true,
      peers: peers.value.size
    }))
  }

  return {
    // State
    rooms,
    peers,
    localStream,
    isConnecting,
    error,
    selfId,
    activeStrategies,
    isReady,
    // Computed
    peerCount,
    isConnected,
    peerList,
    // Methods
    init,
    createRoom,
    joinRoom,
    leaveRoom,
    leaveAllRooms,
    updateStream,
    setOnStreamReceived,
    getStrategyStatus
  }
}
