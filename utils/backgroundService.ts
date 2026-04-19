import BackgroundService from 'react-native-background-actions';
import { Accelerometer } from 'expo-sensors';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import { Vibration, PermissionsAndroid, Platform } from 'react-native';
import { SendDirectSms } from 'react-native-send-direct-sms';
import {
  getGuardiansOffline,
  saveLastLocation,
  getLastLocation,
} from './guardianStorage';
import { retryQueue, QueuedMessage } from './sosQueue';
import NetInfo from '@react-native-community/netinfo';
import { auth } from '../config/firebase';
import { db } from '../config/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

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
  const hasPermission = await requestSmsPermission();
  if (!hasPermission) return;
  for (const number of numbers) {
    try {
      await SendDirectSms(number, message);
    } catch (e) {
      console.log('SMS error for', number, ':', e);
    }
  }
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

const triggerSOS = async (reason: string) => {
  try {
    let lat: number;
    let lng: number;
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
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
    const message = `🚨 SOS EMERGENCY! (${reason})\nI need immediate help!\nMy location:\nhttps://maps.google.com/?q=${lat},${lng}\n- Sent from SAKHI app`;
    await sendSMS(numbers, message);

    const net = await NetInfo.fetch();
    if (net.isConnected) {
      await retryQueue(async (msg: QueuedMessage) => {
        console.log('Retrying queued task:', msg.taskType);
        return true;
      });
    }
  } catch (e) {
    console.log('Background SOS error:', e);
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

const backgroundTask = async (taskData: any) => {
  // Step 1: Set safe zone from current location
  try {
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    safeZoneCenter = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
    await saveLastLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
  } catch {
    const last = await getLastLocation();
    if (last) safeZoneCenter = { latitude: last.lat, longitude: last.lng };
  }

  // Step 2: Retry any queued tasks if online
  try {
    const net = await NetInfo.fetch();
    if (net.isConnected) {
      await retryQueue(async (msg: QueuedMessage) => {
        console.log('Processing queued task:', msg.taskType);
        return true;
      });
    }
  } catch {}

  // Step 3: Shake + Fall Detection (ONLY here, not in index.tsx)
  Accelerometer.setUpdateInterval(100);
  accelerometerSubscription = Accelerometer.addListener(({ x, y, z }) => {
    const total = Math.sqrt(x * x + y * y + z * z);
    const now = Date.now();

    // Shake
    if (total > SHAKE_THRESHOLD && now - lastTriggerTime > 3000) {
      lastTriggerTime = now;
      Vibration.vibrate([0, 200, 100, 200]);
      triggerSOS('Shake Detected');
    }

    // Fall Phase 1 — free fall
    if (total < FALL_FREE_FALL_THRESHOLD && !isFalling) {
      isFalling = true;
      fallTimer = setTimeout(() => { isFalling = false; }, 1000);
    }

    // Fall Phase 2 — impact
    if (isFalling && total > FALL_IMPACT_THRESHOLD) {
      isFalling = false;
      clearTimeout(fallTimer);
      if (now - lastTriggerTime > 3000) {
        lastTriggerTime = now;
        Vibration.vibrate([0, 500, 200, 500, 200, 500]);
        triggerSOS('Fall Detected');
      }
    }
  });

  // Step 4: Battery Monitor
  batterySubscription = Battery.addBatteryLevelListener(async ({ batteryLevel }) => {
    const pct = Math.round(batteryLevel * 100);
    if (pct <= 20 && !batteryAlertSent) {
      batteryAlertSent = true;
      await triggerBatteryAlert(pct);
    }
    if (pct > 20) batteryAlertSent = false;
  });

  // Step 5: Location Watch — Safe Zone
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

  // Keep task alive forever
  await new Promise(() => {});
};

const backgroundOptions = {
  taskName: 'SAKHIProtection',
  taskTitle: '🛡️ SAKHI is protecting you',
  taskDesc: 'Monitoring shake, fall, battery & location in background',
  taskIcon: { name: 'ic_launcher', type: 'mipmap' },
  color: '#e11d48',
  linkingURI: 'sakhiapp://',
  parameters: {},
};

export const startBackgroundProtection = async () => {
  try {
    const isRunning = await BackgroundService.isRunning();
    if (!isRunning) {
      await BackgroundService.start(backgroundTask, backgroundOptions);
      console.log('✅ SAKHI background service started');
    }
  } catch (e) {
    console.log('Background start error:', e);
  }
};

export const stopBackgroundProtection = async () => {
  try {
    accelerometerSubscription?.remove();
    batterySubscription?.remove();
    locationSubscription?.remove();
    clearTimeout(fallTimer);
    await BackgroundService.stop();
    console.log('🛑 SAKHI background service stopped');
  } catch (e) {
    console.log('Background stop error:', e);
  }
};