import { Accelerometer } from 'expo-sensors';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { Vibration, PermissionsAndroid, Platform } from 'react-native';
import *  as SMS from 'expo-sms';
import { getGuardiansOffline, saveLastLocation, getLastLocation } from './guardianStorage';
import { auth, db } from '../config/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { addToQueue, retryQueue, sendWhatsAppMessage, QueuedMessage } from './sosQueue';
import NetInfo from '@react-native-community/netinfo';
import { rtdb } from '../config/firebase';
import { ref, set, remove } from 'firebase/database';
import { Audio } from 'expo-av';
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../config/firebase';

const SHAKE_THRESHOLD = 2.5;
const FALL_FREE_FALL_THRESHOLD = 0.3;
const FALL_IMPACT_THRESHOLD = 2.8;
const SAFE_ZONE_RADIUS_METERS = 500;

let isFalling = false;
let fallTimer: any = null;
let lastTriggerTime = 0;
let safeZoneCenter: { latitude: number; longitude: number } | null = null;
let safeZoneAlertSent = false;
let batteryAlertSent = false;
let accelerometerSubscription: any = null;
let batterySubscription: any = null;
let locationSubscription: any = null;
let isRunning = false;
let liveTrackingInterval: any = null;
let liveTrackingTimeout: any = null;
let recordingInstance: Audio.Recording | null = null;

let onTriggerCallback: ((reason: string) => void) | null = null;
export const setTriggerCallback = (cb: (reason: string) => void) => {
  onTriggerCallback = cb;
};
const fireTrigger = (reason: string) => {
  if (onTriggerCallback) onTriggerCallback(reason);
  else triggerSOS(reason);
};

const getNumbers = async (): Promise<string[]> => {
  try {
    const net = await NetInfo.fetch();
    if (net.isConnected) {
      const user = auth.currentUser;
      if (user) {
        const q = query(collection(db, 'guardians'), where('uid', '==', user.uid));
        const snap = await getDocs(q);
        if (!snap.empty) return snap.docs.map(d => d.data().phone);
      }
    }
  } catch {}
  const offline = await getGuardiansOffline();
  return offline.map((g: any) => g.phone);
};

const requestSmsPermission = async (): Promise<boolean> => {
  if (Platform.OS !== 'android') return false;
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.SEND_SMS,
      {
        title: 'SMS Permission',
        message: 'SAKHI needs SMS permission to send emergency alerts.',
        buttonPositive: 'Allow',
      }
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
};

const sendSMS = async (numbers: string[], message: string) => {
  const isAvailable = await SMS.isAvailableAsync();
  if (!isAvailable) return;
  await SMS.sendSMSAsync(numbers, message);
};
const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export const startLiveTracking = async (uid: string) => {
  if (liveTrackingInterval) return; // already running

  const writeLocation = async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      await set(ref(rtdb, `locations/${uid}`), {
        lat: loc.coords.latitude,
        lng: loc.coords.longitude,
        timestamp: Date.now(),
      });
    } catch (e) {
      console.log('Live tracking write error:', e);
    }
  };

  await writeLocation(); // write immediately on SOS
  liveTrackingInterval = setInterval(writeLocation, 5000); // then every 5s

  // Auto-stop after 30 minutes
  liveTrackingTimeout = setTimeout(() => {
    stopLiveTracking(uid);
  }, 30 * 60 * 1000);

  console.log('📍 Live tracking started');
};

export const stopLiveTracking = async (uid: string) => {
  if (liveTrackingInterval) {
    clearInterval(liveTrackingInterval);
    liveTrackingInterval = null;
  }
  if (liveTrackingTimeout) {
    clearTimeout(liveTrackingTimeout);
    liveTrackingTimeout = null;
  }
  try {
    await remove(ref(rtdb, `locations/${uid}`));
  } catch (e) {
    console.log('Stop tracking error:', e);
  }
  console.log('🛑 Live tracking stopped');
};

export const startAudioEvidence = async (uid: string): Promise<string | null> => {
  try {
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) {
      console.log('Audio permission denied');
      return null;
    }

    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });

    const { recording } = await Audio.Recording.createAsync(
      Audio.RecordingOptionsPresets.HIGH_QUALITY
    );
    recordingInstance = recording;
    console.log('🎙️ Audio evidence recording started - 5 mins');

    // Stop after 5 minutes, upload to Cloudinary, send via WhatsApp
    setTimeout(async () => {
      try {
        if (!recordingInstance) return;
        await recordingInstance.stopAndUnloadAsync();
        const uri = recordingInstance.getURI();
        recordingInstance = null;
        if (!uri) return;

        console.log('🎙️ Recording complete, uploading to Cloudinary...');

        // Upload to Cloudinary
        const formData = new FormData();
        formData.append('file', {
          uri,
          type: 'audio/m4a',
          name: `evidence_${Date.now()}.m4a`,
        } as any);
        formData.append('upload_preset', 'sakhi_evidence');
        formData.append('resource_type', 'raw');

        const response = await fetch(
          'https://api.cloudinary.com/v1_1/doryaq2rh/raw/upload',
          { method: 'POST', body: formData }
        );
        const data = await response.json();
        const audioUrl = data.secure_url;

        console.log('✅ Audio uploaded:', audioUrl);

      
        // REPLACE with — send SMS with audio link instead of WhatsApp:
const numbers = await getNumbers();
if (numbers.length > 0) {
  const audioMessage = `🚨 SAKHI Audio Evidence: ${audioUrl}`;
  
  // Use SMS — works reliably in background after 2 mins
  await sendSMS(numbers, audioMessage);
  
  console.log('✅ Audio evidence link sent via SMS to all guardians');
}
      } catch (e) {
        console.log('Audio upload error:', e);
      }
    }, 2 * 60 * 1000); // 2 minutes

    return 'recording_started';
  } catch (e) {
    console.log('Audio evidence error:', e);
    return null;
  }
};
    

 export const triggerSOS = async (reason: string) => {
  try {
    let lat: number;
    let lng: number;
    try {
      const loc = await Location.getCurrentPositionAsync({ 
        accuracy: Location.Accuracy.High 
      });
      lat = loc.coords.latitude;
      lng = loc.coords.longitude;
      await saveLastLocation({ lat, lng });
    } catch {
      const last = await getLastLocation();
      if (!last) return;
      lat = last.lat;
      lng = last.lng;
    }

    const numbers = await getNumbers();
    if (!numbers.length) return;

    const user = auth.currentUser;
const uid = user?.uid || 'unknown';
// Start live tracking
if (user) await startLiveTracking(uid);
// Start audio evidence
startAudioEvidence(uid); // don't await — runs in background
console.log('UID:', uid); 

const trackingLink = `https://sakhi-46fc5.web.app/track/?uid=${uid}`;
const staticLocation = `https://maps.google.com/?q=${lat},${lng}`;

const smsMessage = `🚨 SOS EMERGENCY! (${reason})\nI need immediate help!\n📍 Track me LIVE: ${trackingLink}\n(Static: ${staticLocation})\n- Sent from SAKHI app`;
const whatsappMessage = `🚨 *SOS EMERGENCY!* (${reason})\nI need immediate help!\n📍 *Track me LIVE:* ${trackingLink}\n- Sent from SAKHI app`;

    // Step 1 — Send SMS first
    await sendSMS(numbers, smsMessage);

    // Step 2 — Queue WhatsApp for each guardian
    const net = await NetInfo.fetch();
    // REPLACE with:
if (net.isConnected) {
  for (const phone of numbers) {
    await sendWhatsAppMessage(phone, whatsappMessage);
  }
}else {
  for (const phone of numbers) {
    await addToQueue('SOS', 'WHATSAPP_LOCATION_LINK', phone, {
      lat,
      lng,
      message: whatsappMessage,
    });
  }
}

  } catch (e) {
    console.log('SOS error:', e);
  }
};

const triggerBatteryAlert = async (pct: number) => {
  try {
    let locationStr = 'Unavailable';
    try {
      const loc = await Location.getCurrentPositionAsync({});
      locationStr = `https://maps.google.com/?q=${loc.coords.latitude},${loc.coords.longitude}`;
    } catch {
      const last = await getLastLocation();
      if (last) locationStr = `https://maps.google.com/?q=${last.lat},${last.lng}`;
    }
    const numbers = await getNumbers();
    if (!numbers.length) return;
    const msg = `🔋 Battery Alert!\n${auth.currentUser?.email || 'User'} battery is at ${pct}%\nLocation: ${locationStr}\n- Sent from SAKHI app`;
    await sendSMS(numbers, msg);
  } catch (e) {
    console.log('Battery alert error:', e);
  }
};

const triggerSafeZoneAlert = async (lat: number, lng: number) => {
  try {
    const numbers = await getNumbers();
    if (!numbers.length) return;
    const msg = `📍 Safe Zone Alert!\n${auth.currentUser?.email || 'User'} has left the safe area!\nCurrent Location: https://maps.google.com/?q=${lat},${lng}\n- Sent from SAKHI app`;
    await sendSMS(numbers, msg);
  } catch (e) {
    console.log('Safe zone alert error:', e);
  }
};

export const startBackgroundProtection = async () => {
  if (isRunning) return;
  isRunning = true;
   
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    console.log('Location permission not granted');
    isRunning = false;
    return;
  }

  try {
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    safeZoneCenter = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
    await saveLastLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
  } catch {
    const last = await getLastLocation();
    if (last) safeZoneCenter = { latitude: last.lat, longitude: last.lng };
  }

  Accelerometer.setUpdateInterval(100);
  accelerometerSubscription = Accelerometer.addListener(({ x, y, z }) => {
    const total = Math.sqrt(x * x + y * y + z * z);
    const now = Date.now();

    if (total > SHAKE_THRESHOLD && now - lastTriggerTime > 3000) {
      lastTriggerTime = now;
      Vibration.vibrate([0, 200, 100, 200]);
      fireTrigger('Shake Detected');
    }

    if (total < FALL_FREE_FALL_THRESHOLD && !isFalling) {
      isFalling = true;
      fallTimer = setTimeout(() => { isFalling = false; }, 1000);
    }

    if (isFalling && total > FALL_IMPACT_THRESHOLD) {
      isFalling = false;
      clearTimeout(fallTimer);
      if (now - lastTriggerTime > 3000) {
        lastTriggerTime = now;
        Vibration.vibrate([0, 500, 200, 500, 200, 500]);
        fireTrigger('Fall Detected');
      }
    }
  });

  batterySubscription = Battery.addBatteryLevelListener(async ({ batteryLevel }) => {
    const pct = Math.round(batteryLevel * 100);
    if (pct <= 20 && !batteryAlertSent) {
      batteryAlertSent = true;
      await triggerBatteryAlert(pct);
    }
    if (pct > 20) batteryAlertSent = false;
  });

  locationSubscription = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 50 },
    async (loc) => {
      const { latitude, longitude } = loc.coords;
      await saveLastLocation({ lat: latitude, lng: longitude });
      if (!safeZoneCenter) return;
      const dist = getDistance(latitude, longitude, safeZoneCenter.latitude, safeZoneCenter.longitude);
      if (dist > SAFE_ZONE_RADIUS_METERS && !safeZoneAlertSent) {
        safeZoneAlertSent = true;
        await triggerSafeZoneAlert(latitude, longitude);
      }
      if (dist <= SAFE_ZONE_RADIUS_METERS) safeZoneAlertSent = false;
    }
  );

  console.log('✅ SAKHI protection started');
};

export const stopBackgroundProtection = async () => {
  isRunning = false;
  accelerometerSubscription?.remove();
  batterySubscription?.remove();
  locationSubscription?.remove();
  clearTimeout(fallTimer);
  console.log('🛑 SAKHI protection stopped');
};