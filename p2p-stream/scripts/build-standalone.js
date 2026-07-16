#!/usr/bin/env node
/**
 * Build script to create a standalone single-file HTML version
 * This inlines all JS, CSS, and assets into one HTML file
 * 
 * IMPORTANT: Due to browser security (CORS, CSP), this file CANNOT be opened
 * directly from Downloads (file:// protocol). It MUST be served via:
 * - HTTPS (recommended)
 * - localhost (for local testing)  
 * - A local file server app on your phone
 * - WiFi hotspot from another device
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.join(__dirname, '..')

async function buildStandalone() {
  console.log('Building standalone HTML file...')

  // Read the built index.html
  const distIndexPath = path.join(rootDir, 'dist', 'index.html')
  if (!fs.existsSync(distIndexPath)) {
    console.error('Error: dist/index.html not found. Run "npm run build" first.')
    process.exit(1)
  }

  let html = fs.readFileSync(distIndexPath, 'utf-8')

  // Remove service worker registration (causes issues with file://)
  html = html.replace(/<script[^>]*id="vite-plugin-pwa[^"]*"[^>]*>.*?<\/script>/g, '')
  html = html.replace(/<link[^>]*rel="manifest"[^>]*>/g, '')
  html = html.replace(/<link[^>]*rel="icon"[^>]*>/g, '')

  // Remove preload/modulepreload links (we'll inline everything)
  html = html.replace(/<link[^>]*rel="preload"[^>]*>/g, '')
  html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>/g, '')
  html = html.replace(/crossorigin/g, '')

  // Inline CSS files
  const cssMatches = html.match(/<link[^>]*href="([^"]*\.css)"[^>]*>/g) || []
  for (const match of cssMatches) {
    const href = match.match(/href="([^"]*)"/)?.[1]
    if (href) {
      const cssPath = path.join(rootDir, 'dist', href.replace(/^\//, ''))
      if (fs.existsSync(cssPath)) {
        const css = fs.readFileSync(cssPath, 'utf-8')
        html = html.replace(match, `<style>${css}</style>`)
        console.log(`  ✓ Inlined CSS: ${href}`)
      }
    }
  }

  // Inline JS files
  const jsMatches = html.match(/<script[^>]*src="([^"]*\.js)"[^>]*><\/script>/g) || []
  for (const match of jsMatches) {
    const src = match.match(/src="([^"]*)"/)?.[1]
    if (src && !src.includes('@')) {
      const jsPath = path.join(rootDir, 'dist', src.replace(/^\//, ''))
      if (fs.existsSync(jsPath)) {
        const js = fs.readFileSync(jsPath, 'utf-8')
        // Check if it's a module
        const isModule = match.includes('type="module"')
        const scriptTag = isModule 
          ? `<script type="module">${js}</script>`
          : `<script>${js}</script>`
        html = html.replace(match, scriptTag)
        console.log(`  ✓ Inlined JS: ${src}`)
      }
    }
  }

  // Add standalone-specific styles and scripts
  const standaloneHead = `
    <style>
      /* File protocol warning banner */
      .file-protocol-warning {
        display: none;
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: #dc2626;
        color: white;
        padding: 16px;
        font-size: 14px;
        text-align: center;
        z-index: 99999;
        line-height: 1.5;
      }
      .file-protocol-warning h3 {
        margin: 0 0 8px 0;
        font-size: 16px;
      }
      .file-protocol-warning p {
        margin: 0 0 12px 0;
        opacity: 0.9;
      }
      .file-protocol-warning button {
        background: white;
        color: #dc2626;
        border: none;
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
        margin: 4px;
      }
      .file-protocol-warning button:hover {
        background: #f3f4f6;
      }
      body.file-protocol .file-protocol-warning {
        display: block;
      }
      body.file-protocol {
        padding-top: 140px !important;
      }
      
      /* Standalone mode indicator */
      .standalone-badge {
        position: fixed;
        bottom: 8px;
        right: 8px;
        background: rgba(0,0,0,0.7);
        color: #9ca3af;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 10px;
        z-index: 9999;
      }
    </style>
  `

  const standaloneBody = `
    <!-- File Protocol Warning -->
    <div class="file-protocol-warning">
      <h3>⚠️ Cannot Open Directly From Downloads</h3>
      <p>Due to browser security, camera and streaming require the file to be served via HTTPS or localhost.</p>
      <p><strong>Quick fixes:</strong></p>
      <button onclick="showFileProtocolHelp()">How to Fix</button>
      <button onclick="this.parentElement.style.display='none'; document.body.classList.remove('file-protocol')">Dismiss</button>
    </div>
    
    <div class="standalone-badge">STANDALONE</div>
    
    <script>
      // File protocol detection
      (function() {
        if (window.location.protocol === 'file:') {
          document.body.classList.add('file-protocol');
          console.error('P2P Stream: File protocol detected. Camera and streaming blocked by browser security.');
          console.error('Solutions: Use a file server app, WiFi hotspot, or run: npx serve -s . -p 4400');
        }
        
        window.showFileProtocolHelp = function() {
          alert(
            'BROWSER SECURITY BLOCKS CAMERA ON FILE://\\n\\n' +
            'You CANNOT open this file directly from Downloads.\\n\\n' +
            'SOLUTIONS:\\n\\n' +
            '1. WiFi Hotspot + File Server App (Easiest)\\n' +
            '   - Install "Documents by Readdle" (iOS) or "MiXplorer" (Android)\\n' +
            '   - Enable WiFi hotspot on one phone\\n' +
            '   - Use file server app to serve this HTML\\n' +
            '   - Others connect to hotspot and open the URL\\n\\n' +
            '2. Transfer to Laptop\\n' +
            '   - Put this file on a laptop\\n' +
            '   - Run: npx serve -s . -p 4400\\n' +
            '   - Connect phones to laptop hotspot\\n\\n' +
            '3. Portable Router\\n' +
            '   - Bring a travel WiFi router (no internet needed)\\n' +
            '   - Everyone connects to router\\n' +
            '   - One phone serves the file\\n\\n' +
            '4. ngrok (If you have internet)\\n' +
            '   - npm install -g ngrok\\n' +
            '   - ngrok http 4400\\n' +
            '   - Share the HTTPS URL'
          );
        };
        
        // Log browser info for debugging
        console.log('P2P Stream Standalone');
        console.log('Protocol:', window.location.protocol);
        console.log('Secure context:', window.isSecureContext);
        console.log('Camera supported:', !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia));
      })();
    </script>
  `

  // Insert before </head>
  html = html.replace('</head>', standaloneHead + '</head>')
  
  // Insert before </body>
  html = html.replace('</body>', standaloneBody + '</body>')

  // Write the standalone file
  const outputPath = path.join(rootDir, 'dist', 'p2p-stream-standalone.html')
  fs.writeFileSync(outputPath, html)

  // Calculate size
  const sizeKB = (fs.statSync(outputPath).size / 1024).toFixed(2)

  console.log(`\n✅ Standalone file created: ${outputPath}`)
  console.log(`   Size: ${sizeKB} KB`)
  console.log(`\n✅ OFFLINE-FIRST: After installation, the PWA works without any server!`)
  console.log(`   Service Worker caches all code locally for offline use.`)
  console.log(`   Stream P2P over local WiFi - no internet needed.`)
  console.log(`\n⚠️  FIRST INSTALL: This file CANNOT be opened directly from Downloads!`)
  console.log(`   Browsers block camera on file:// protocol for security.`)
  console.log(`\n   To INSTALL the PWA, serve it via:`)
  console.log(`   1. WiFi hotspot + file server app (recommended)`)
  console.log(`   2. Transfer to laptop: npx serve -s . -p 4400`)
  console.log(`   3. Portable WiFi router`)
  console.log(`\n   After install, the app works 100% offline - no server needed!`)
  console.log(`   See OFFLINE_PWA.md for complete instructions.`)
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  buildStandalone().catch(console.error)
}

export { buildStandalone }
