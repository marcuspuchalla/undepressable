# Project Plan: P2P Emergency Streaming

## Overview

This document breaks down the implementation into actionable tasks with timelines, dependencies, and deliverables.

---

## Phase 1: Foundation (Weeks 1-4)

### Week 1: Project Setup
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| Initialize Vue 3 project | Dev | Repo with basic structure | None |
| Configure TypeScript | Dev | tsconfig, type definitions | Project init |
| Setup Vite + PWA | Dev | vite.config with workbox | Project init |
| Configure linting/formatting | Dev | ESLint + Prettier config | Project init |
| Setup testing framework | Dev | Vitest + testing library | Project init |

### Week 2: UI Framework
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| Install PrimeVue | Dev | Working component library | Week 1 |
| Configure Tailwind | Dev | tailwind.config with theme | Week 1 |
| Create base layouts | Dev | StreamerLayout, CollectorLayout | PrimeVue |
| Implement navigation | Dev | Router with route guards | Layouts |
| Dark mode support | Dev | Theme switching | Tailwind |

### Week 3: Media Foundation
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| Camera access module | Dev | useCamera composable | None |
| Audio/Video constraints | Dev | Quality presets | Camera module |
| Permission handling | Dev | Graceful denial UX | Camera module |
| Stream preview component | Dev | Local video preview | Camera module |
| Device selection UI | Dev | Camera/mic dropdown | Stream preview |

### Week 4: Basic WebRTC
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| Simple-peer integration | Dev | Working peer connection | None |
| Signaling server setup | Dev | Node.js + WebSocket server | None |
| Offer/Answer flow | Dev | Connection establishment | Signaling server |
| ICE candidate handling | Dev | NAT traversal working | Offer/Answer |
| Basic video streaming | Dev | Video flows peer-to-peer | ICE handling |

**Phase 1 Milestone**: Two browsers can connect and stream video bidirectionally

---

## Phase 2: Recording & Storage (Weeks 5-7)

### Week 5: MediaRecorder Integration
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| MediaRecorder setup | Dev | Recorder with timeslice | Week 4 |
| Chunk generation | Dev | 1-second chunks working | MediaRecorder |
| Chunk metadata | Dev | Timestamp, index, checksum | Chunk generation |
| Recorder controls | Dev | Start/stop/pause UI | MediaRecorder |
| Recording state mgmt | Dev | Pinia store for recording | Controls |

### Week 6: OPFS Storage
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| OPFS integration | Dev | File system access working | None |
| Directory structure | Dev | Campaign-based file organization | OPFS |
| Chunk persistence | Dev | Chunks saved immediately | Directory structure |
| Storage monitoring | Dev | Quota usage tracking | OPFS |
| Storage management | Dev | Auto-cleanup old recordings | Quota monitoring |

### Week 7: Playback & Export
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| Chunk retrieval | Dev | Read chunks from OPFS | Week 6 |
| MediaSource playback | Dev | Seamless chunk playback | Chunk retrieval |
| Playback controls | Dev | Play/pause/seek/scrubber | MediaSource |
| Export functionality | Dev | Download as WebM | Playback |
| Recording list UI | Dev | Browse past recordings | Export |

**Phase 2 Milestone**: Recordings are chunked, persisted, and playable/exportable

---

## Phase 3: Multi-Peer & Hierarchy (Weeks 8-11)

### Week 8: Multi-Peer Foundation
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| Peer manager class | Dev | Manage multiple RTCPeerConnections | Week 4 |
| Connection pool | Dev | Track all active connections | Peer manager |
| Role assignment | Dev | Streamer/Collector roles | Connection pool |
| Role-based UI | Dev | Different interfaces per role | Role assignment |
| Peer state monitoring | Dev | Connection health tracking | Connection pool |

### Week 9: Hierarchical Topology
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| Primary collector logic | Dev | Direct connection from streamer | Week 8 |
| Secondary collector logic | Dev | Connection through primary | Primary logic |
| Video forwarding | Dev | Re-stream received video | Secondary logic |
| Forwarding management | Dev | Track who forwards to whom | Video forwarding |
| Topology visualization | Dev | Network graph UI | Forwarding mgmt |

### Week 10: Quality & Adaptation
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| Stats collection | Dev | RTC stats monitoring | Week 9 |
| Bandwidth estimation | Dev | Available bandwidth calc | Stats collection |
| Quality adaptation | Dev | Auto adjust bitrate/resolution | Bandwidth estimation |
| Manual quality selection | Dev | User override options | Quality adaptation |
| Network warnings | Dev | Poor connection alerts | Stats collection |

### Week 11: Resilience
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| Reconnection logic | Dev | Auto-reconnect on drop | Week 10 |
| Role promotion | Dev | Secondary → Primary on failure | Reconnection |
| Redundant connections | Dev | Streamer → 2-3 primaries | Role promotion |
| Graceful degradation | Dev | Reduce quality before drop | Redundant connections |
| Recovery UI | Dev | Show reconnection status | Reconnection |

**Phase 3 Milestone**: 1 streamer → 3 primaries → 6-12 secondaries working reliably

---

## Phase 4: Campaign Management (Weeks 12-14)

### Week 12: Campaign Core
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| Campaign data model | Dev | TypeScript interfaces | None |
| Campaign creation | Dev | Streamer can create campaign | Data model |
| Campaign listing | Dev | Browse active campaigns | Creation |
| Campaign detail view | Dev | Full campaign info | Listing |
| Campaign joining | Dev | Collectors can join | Detail view |

### Week 13: State Synchronization
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| Yjs integration | Dev | CRDT library setup | Week 12 |
| Campaign state sync | Dev | Real-time updates across peers | Yjs |
| Conflict resolution | Dev | Handle concurrent edits | State sync |
| Optimistic updates | Dev | Responsive UI during sync | Conflict resolution |
| Offline support | Dev | Queue updates when disconnected | State sync |

### Week 14: QR Code & Quick Join
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| QR generation | Dev | Create campaign QR codes | Week 13 |
| QR scanning | Dev | Camera-based QR reader | Generation |
| Deep linking | Dev | URL-based campaign join | QR scanning |
| Invitation sharing | Dev | Share via messaging apps | Deep linking |
| Join history | Dev | Recently joined campaigns | All above |

**Phase 4 Milestone**: Full campaign lifecycle with QR code joining

---

## Phase 5: Censorship Resistance (Weeks 15-17)

### Week 15: Decentralized Signaling
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| libp2p research | Dev | Browser compatibility verified | None |
| libp2p WebRTC transport | Dev | P2P discovery without server | Research |
| Bootstrap node config | Dev | Public libp2p bootstrap nodes | Transport |
| DHT peer discovery | Dev | Find peers via DHT | Bootstrap |
| Signaling fallback chain | Dev | WS → libp2p → QR | All above |

### Week 16: Serverless Connection
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| QR SDP exchange | Dev | Full SDP in QR code | Week 15 |
| Manual SDP entry | Dev | Copy-paste SDP fallback | QR exchange |
| Rendezvous protocol | Dev | Match peers without server | Manual entry |
| ICE coordination | Dev | Coordinate candidates serverlessly | Rendezvous |
| QR optimization | Dev | Compress SDP for smaller QR | All above |

### Week 17: Deployment Diversification
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| IPFS build config | Dev | Static build for IPFS | None |
| Single-file build | Dev | All-in-one HTML emergency version | IPFS build |
| GitHub Pages deploy | Dev | Automated GH Pages deployment | Build configs |
| Multi-domain config | Dev | Configurable signaling endpoints | GH Pages |
| Mirror documentation | Dev | Guide for community mirrors | All above |

**Phase 5 Milestone**: App works without any central infrastructure

---

## Phase 6: Polish & Security (Weeks 18-20)

### Week 18: Mobile Optimization
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| Mobile UI audit | Dev | Touch-friendly interface | All prior |
| Responsive layouts | Dev | Works on all screen sizes | Audit |
| Battery optimization | Dev | Efficient recording/streaming | Responsive |
| Background audio | Dev | Continue in background | Battery |
| Mobile-specific UX | Dev | Swipe gestures, etc. | All above |

### Week 19: Security Hardening
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| Crypto key generation | Dev | Ed25519 key pairs in browser | None |
| Identity management | Dev | Key storage and retrieval | Key generation |
| Message signing | Dev | Sign control messages | Identity |
| Signature verification | Dev | Verify peer identities | Signing |
| Security audit | Security | External review | All above |

### Week 20: Testing & Documentation
| Task | Owner | Deliverable | Dependencies |
|------|-------|-------------|--------------|
| Unit test coverage | Dev | 80%+ coverage | All prior |
| Integration tests | Dev | E2E WebRTC testing | Unit tests |
| Load testing | Dev | 15+ peer simulation | Integration |
| User documentation | Dev | Usage guides | All testing |
| Developer documentation | Dev | Architecture docs | User docs |

**Phase 6 Milestone**: Production-ready with security audit

---

## Dependency Graph

```
Phase 1: Foundation
├── Week 1: Project Setup
├── Week 2: UI Framework
├── Week 3: Media Foundation
└── Week 4: Basic WebRTC
    ↓
Phase 2: Recording & Storage
├── Week 5: MediaRecorder
├── Week 6: OPFS Storage
└── Week 7: Playback & Export
    ↓
Phase 3: Multi-Peer & Hierarchy
├── Week 8: Multi-Peer Foundation
├── Week 9: Hierarchical Topology
├── Week 10: Quality & Adaptation
└── Week 11: Resilience
    ↓
Phase 4: Campaign Management
├── Week 12: Campaign Core
├── Week 13: State Synchronization
└── Week 14: QR Code & Quick Join
    ↓
Phase 5: Censorship Resistance
├── Week 15: Decentralized Signaling
├── Week 16: Serverless Connection
└── Week 17: Deployment Diversification
    ↓
Phase 6: Polish & Security
├── Week 18: Mobile Optimization
├── Week 19: Security Hardening
└── Week 20: Testing & Documentation
```

---

## Resource Requirements

### Development Team
| Role | FTE | Duration | Responsibilities |
|------|-----|----------|------------------|
| Lead Developer | 1.0 | Full project | Architecture, WebRTC, review |
| Frontend Developer | 1.0 | Full project | Vue components, UI/UX |
| Backend/DevOps | 0.5 | Phases 1,5,6 | Signaling servers, deployment |
| Security Consultant | 0.25 | Phase 6 | Audit, cryptography review |
| UX Designer | 0.25 | Phases 1-2 | Wireframes, mobile optimization |

### Infrastructure
| Resource | Purpose | Cost Estimate |
|----------|---------|---------------|
| Signaling servers (3x) | WebSocket bootstrap | $50/month |
| CDN (Cloudflare Pro) | Static hosting | $20/month |
| IPFS Pinning | Decentralized hosting | $10/month |
| Test devices (various) | Mobile testing | One-time $2000 |
| CI/CD (GitHub Actions) | Automated builds | Free |

---

## Risk Management

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| WebRTC incompatibility | Low | High | Extensive testing, fallback UI |
| OPFS quota limits | Medium | Medium | Auto-cleanup, compression |
| libp2p browser issues | Medium | High | Alternative fallbacks ready |
| Mobile battery drain | High | Medium | Optimization, power warnings |

### Schedule Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Phase 1 delays | Low | Medium | Buffer time in schedule |
| WebRTC complexity | Medium | High | External consultant on call |
| Scope creep | Medium | Medium | Strict MVP definition |

### External Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Browser API changes | Low | High | Monitor specs, abstraction layers |
| Legal/regulatory issues | Low | High | Legal review, terms of service |
| Censorship escalation | Medium | High | Multiple deployment strategies |

---

## Success Metrics

### Technical Metrics
- [ ] Latency < 3 seconds end-to-end
- [ ] 15+ simultaneous collectors
- [ ] 99%+ chunk persistence success
- [ ] < 100ms chunk write time
- [ ] Works on Chrome, Firefox, Safari, Edge

### User Metrics
- [ ] Campaign creation < 30 seconds
- [ ] Join via QR < 10 seconds
- [ ] First video frame < 5 seconds
- [ ] Export video < 2x recording duration
- [ ] Mobile battery: 2+ hours continuous

### Security Metrics
- [ ] No unencrypted video transmission
- [ ] Pass security audit
- [ ] No PII required for basic use
- [ ] Graceful handling of all disconnections

---

## Post-MVP Features (Future)

1. **Native Apps**: React Native or Capacitor wrappers
2. **Advanced Encryption**: Double ratchet for control messages
3. **Blockchain Anchoring**: Video hash on blockchain for timestamp proof
4. **AI Features**: Automatic transcription, object detection
5. **Federation**: Connect multiple independent networks
6. **Hardware Wallets**: Sign streams with hardware keys

---

## Communication Plan

### Daily
- Async standup in project chat
- Blocker escalation within 4 hours

### Weekly
- Video sync meeting (30 min)
- Progress update document
- Demo of completed features

### Per Phase
- Phase retrospective
- Planning for next phase
- Stakeholder demo

### Continuous
- GitHub issues for tasks
- Pull request reviews
- Documentation updates

---

## Review Checkpoints

### Phase 1 Review (Week 4)
- [ ] Basic P2P video working
- [ ] UI responsive and accessible
- [ ] Code review complete
- [ ] Decision: Continue to Phase 2

### Phase 3 Review (Week 11)
- [ ] Multi-peer hierarchy working
- [ ] 10+ collectors tested
- [ ] Quality adaptation functional
- [ ] Decision: Continue to Phase 4

### Phase 5 Review (Week 17)
- [ ] Serverless connection working
- [ ] Censorship resistance tested
- [ ] Multiple deployments verified
- [ ] Decision: Continue to final polish

### Final Review (Week 20)
- [ ] Security audit passed
- [ ] All tests passing
- [ ] Documentation complete
- [ ] Production deployment ready

---

*Document Version: 1.0*
*Last Updated: 2026-01-28*
