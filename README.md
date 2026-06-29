# SAKHI 🛡️ — Smart Women Safety & Emergency Response System

> *Because every woman deserves to feel safe.*

SAKHI is a React Native mobile app for women's safety. It combines automatic SOS alerts, live location sharing, voice/shake/fall detection, and audio evidence recording into one intelligent safety companion.

---

## 🚨 Core Features

### SOS System
- One-tap SOS button with 5-second cancel window
- Auto SMS to all guardians with live location link
- Sequential auto-calling with fallback to next guardian
- WhatsApp fallback if SMS fails (retry queue on reconnect)

### Smart Detection Triggers
- 🎙️ Voice trigger — say "help", "bachao", or "emergency"
- 📳 Shake detection SOS
- 🤸 Fall detection SOS
- 🔋 Battery ≤20% auto alert to guardians
- 📍 Geofence / safe zone exit alert

### Live Location Sharing 🗺️
- Generates a live tracking link sent to guardians via SMS
- Guardian opens link in browser and sees user moving in real time

### Audio Evidence Recording 🎙️
- Auto-records 5 minutes of audio when SOS triggers
- Saved locally as forensic evidence
- Opens WhatsApp with audio file attached for guardian

### Safe Walk Timer
- Set a timer for your walk; auto-triggers SOS if you don't check in
- Works correctly even when app is minimized

### Fake Call 📞
- Simulates an incoming call with TTS conversation
- Always shows latest guardian contacts

### Live GPS Map 🗺️
- Real-time location tracking with route trail
- Destination search + walking route via OSRM
- Nearby police stations and hospitals with one-tap call

### Guardian Management
- Add/delete up to 5 guardians
- Offline cache + Firebase Firestore sync

- ## 📁 Project Structure
sakhi-app/
├── app/              → React Native screens (Expo Router)
├── components/       → Reusable UI components  
├── utils/            → Background services, SOS queue, storage
├── config/           → Firebase configuration
├── hooks/            → Custom React hooks
├── constants/        → App-wide constants
└── sakhi-backend/    → Node.js + Express backend
                        (monorepo structure for single submission)

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| Framework | React Native + Expo Router |
| Language | TypeScript |
| Auth & DB | Firebase Auth + Firestore |
| Maps | react-native-maps, Overpass API, OSRM |
| SMS | expo-sms |
| Location | expo-location |
| Audio | expo-av |
| Speech | expo-speech-recognition |
| Backend | Node.js + Express |

---

*Built with ❤️ for women's safety.*
