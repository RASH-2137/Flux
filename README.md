# Flux

A peer-to-peer encrypted video calling application built with WebRTC, Socket.io, and Capacitor. Supports browser and native Android.

**Live Demo:** [https://flux-stream-zmdi.onrender.com](https://vc.spacekid.xyz)

## Features

- One-to-one video calls with end-to-end encryption (WebRTC DTLS-SRTP)
- Ephemeral text chat over a direct WebRTC DataChannel
- Screen sharing (desktop browsers)
- Camera toggle with avatar fallback
- Camera flip (front/rear) on mobile
- Works as a browser app or a native Android APK via Capacitor

## Architecture

```
Browser/Android  ──  signaling (Socket.io)  ──  server.js
     │                                                │
     └──────────── WebRTC P2P (DTLS-SRTP) ───────────┘
              video · audio · DataChannel chat
```

The signaling server only brokers the initial WebRTC handshake (offer/answer/ICE). All media and chat data flows directly between peers and never passes through the server.

## Stack

| Layer | Technology |
|-------|-----------|
| Signaling server | Node.js, Express, Socket.io |
| Peer connection | WebRTC (native browser API) |
| Android packaging | Capacitor 8 |
| Frontend | Vanilla JS, HTML, CSS |

## Getting Started

### Prerequisites

- Node.js 18+
- Android Studio (for APK builds)

### Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000` in two browser tabs to test a call.

### Build Android APK

```bash
npx cap sync android
cd android
./gradlew assembleDebug
```

The debug APK is output to `android/app/build/outputs/apk/debug/app-debug.apk`.

### Test on Android emulator

Start the emulator in Android Studio, then:

```bash
adb install -r android/app/build/outputs/apk/debug/app-debug.apk
adb reverse tcp:3000 tcp:3000
```

### Test on a real device (same Wi-Fi)

Open `http://<your-local-ip>:3000` in Chrome on the device. The server prints the local IP address on startup.

## Security

- Video and audio are encrypted in transit via DTLS-SRTP (standard WebRTC).
- Chat messages travel over an encrypted WebRTC DataChannel — not through the server.
- The signaling server holds no user data and maintains no persistent state.

## License

MIT
