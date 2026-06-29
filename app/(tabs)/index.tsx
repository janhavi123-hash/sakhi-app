import 'react-native-reanimated';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Animated, Vibration, Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'expo-router';
import { auth } from '../../config/firebase';
import { onAuthStateChanged, signOut } from 'firebase/auth';
import * as Location from 'expo-location';
import * as Battery from 'expo-battery';
import {
  saveGuardiansOffline,
  saveLastLocation,
  getLastLocation,
} from '../../utils/guardianStorage';
import NetInfo from '@react-native-community/netinfo';
import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { startBackgroundProtection, stopBackgroundProtection } from '../../utils/backgroundService';
import { setTriggerCallback } from '../../utils/backgroundService';
import { triggerSOS } from '../../utils/backgroundService';
// Make sure this line exists:
import { retryQueue, sendWhatsAppMessage } from '../../utils/sosQueue';
import { db } from '../../config/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

const SAFE_ZONE_RADIUS_METERS = 500;
const { width } = Dimensions.get('window');
const VOICE_KEYWORDS = ['help', 'bachao', 'emergency'];


export default function HomeScreen() {
  const router = useRouter();
  const [batteryLevel, setBatteryLevel] = useState<number | null>(null);
  const [safeZone, setSafeZone] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isOffline, setIsOffline] = useState(false);
  const [sosStatus, setSosStatus] = useState<'idle' | 'countdown' | 'sending' | 'sent'>('idle');
  const [countdown, setCountdown] = useState(5);
  const [authReady, setAuthReady] = useState(false);
  const [voiceActive, setVoiceActive] = useState(false);

  const batteryAlertSent = useRef(false);
  const safeZoneAlertSent = useRef(false);
  const countdownInterval = useRef<any>(null);
  const cancelSOS = useRef(false);
  const batterySubscription = useRef<any>(null);
  const sosStatusRef = useRef<'idle' | 'countdown' | 'sending' | 'sent'>('idle');

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const shieldAnim = useRef(new Animated.Value(0)).current;
  
useFocusEffect(
  useCallback(() => {
    setTriggerCallback((reason) => {
      if (sosStatusRef.current === 'idle') triggerSOSWithCountdown();
    });
  }, [])
);
  // Keep sosStatusRef in sync
  useEffect(() => {
    sosStatusRef.current = sosStatus;
  }, [sosStatus]);

  // ── Animations ────────────────────────────────────────
  useEffect(() => {
    Animated.spring(shieldAnim, {
      toValue: 1, useNativeDriver: true, tension: 50, friction: 7,
    }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 1200, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
      ])
    ).start();
  }, []);

  useEffect(() => {
    if (sosStatus === 'countdown' || sosStatus === 'sending') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0, duration: 400, useNativeDriver: true }),
        ])
      ).start();
    } else {
      glowAnim.setValue(0);
    }
  }, [sosStatus]);

  // 🌐 Offline monitor + retry queue on reconnect
useEffect(() => {
  const unsub = NetInfo.addEventListener(async (state) => {
    setIsOffline(!state.isConnected);
    if (state.isConnected) {
      await retryQueue(async (msg) => {
        if (msg.taskType === 'WHATSAPP_LOCATION_LINK') {
          return await sendWhatsAppMessage(
            msg.recipient,
            String(msg.payload.message)
          );
        }
        return false;
      });
    }
  });
  return () => unsub();
}, []);


  // 🔐 Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      setAuthReady(true);
      if (!user) router.replace('/login' as any);
    });
    return unsub;
  }, []);

  // 💾 Cache guardians
useEffect(() => {
  if (!authReady) return;
  const load = async () => {
    try {
      const net = await NetInfo.fetch();
      if (!net.isConnected) return;
      const user = auth.currentUser;
      if (!user) return;  // ← this line stops the auth error
      const q = query(collection(db, 'guardians'), where('uid', '==', user.uid));
      const snap = await getDocs(q);
      if (!snap.empty) await saveGuardiansOffline(snap.docs.map((d: any) => d.data()));
    } catch (e) {
      console.log('Guardian cache error:', e);  // silent, no crash
    }
  };
  load();
}, [authReady]);

  // 🛡️ Start background protection once auth is ready
  useEffect(() => {
    if (!authReady) return;
    startBackgroundProtection();
    // Do NOT stop on unmount — must keep running in background
  }, [authReady]);

  // 🔋 Battery monitor
  useEffect(() => {
    let mounted = true;
    const startBattery = async () => {
      try {
        const level = await Battery.getBatteryLevelAsync();
        if (mounted) setBatteryLevel(Math.round(level * 100));
        batterySubscription.current = Battery.addBatteryLevelListener(({ batteryLevel: lvl }) => {
          if (!mounted) return;
          const pct = Math.round(lvl * 100);
          setBatteryLevel(pct);
          if (pct <= 20 && !batteryAlertSent.current) {
            batteryAlertSent.current = true;
            sendBatteryAlert(pct);
          }
          if (pct > 20) batteryAlertSent.current = false;
        });
      } catch (e) {
        console.log('Battery error:', e);
      }
    };
    startBattery();
    return () => {
      mounted = false;
      batterySubscription.current?.remove();
    };
  }, []);

  // 📍 Location + safe zone
  useEffect(() => {
    let locationSub: any;
    const watch = async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const last = await getLastLocation();
      if (last && !safeZone) setSafeZone({ latitude: last.lat, longitude: last.lng });
      const initial = await Location.getCurrentPositionAsync({});
      setSafeZone({ latitude: initial.coords.latitude, longitude: initial.coords.longitude });
      await saveLastLocation({ lat: initial.coords.latitude, lng: initial.coords.longitude });
      locationSub = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 10000, distanceInterval: 50 },
        async (loc) => {
          await saveLastLocation({ lat: loc.coords.latitude, lng: loc.coords.longitude });
          if (!safeZone) return;
          const dist = getDistance(loc.coords.latitude, loc.coords.longitude, safeZone.latitude, safeZone.longitude);
          if (dist > SAFE_ZONE_RADIUS_METERS && !safeZoneAlertSent.current) {
            safeZoneAlertSent.current = true;
            sendSafeZoneAlert(loc.coords.latitude, loc.coords.longitude);
          }
          if (dist <= SAFE_ZONE_RADIUS_METERS) safeZoneAlertSent.current = false;
        }
      );
    };
    watch();
    return () => { locationSub?.remove(); };
  }, []);

  // 🎤 Voice Recognition — start when auth is ready
  useEffect(() => {
    if (!authReady) return;
    startVoiceListening();
    return () => {
      ExpoSpeechRecognitionModule.abort();
    };
  }, [authReady]);

  // 🎤 Voice result listener
  useSpeechRecognitionEvent('result', (event) => {
    const transcript = event.results?.[0]?.transcript?.toLowerCase() || '';
    const triggered = VOICE_KEYWORDS.some(keyword => transcript.includes(keyword));
    if (triggered && sosStatusRef.current === 'idle') {
      ExpoSpeechRecognitionModule.abort();
      setVoiceActive(false);
      Vibration.vibrate([0, 300, 100, 300]);
      triggerSOSWithCountdown();
    }
  });

  // 🎤 Restart voice after it ends (if not in SOS)
  useSpeechRecognitionEvent('end', () => {
    if (sosStatusRef.current === 'idle') {
      setTimeout(() => startVoiceListening(), 500);
    }
  });

  // 🎤 Handle voice errors — restart after delay
  useSpeechRecognitionEvent('error', (event) => {
    console.log('Voice error:', event.error);
    setVoiceActive(false);
    if (sosStatusRef.current === 'idle') {
      setTimeout(() => startVoiceListening(), 3000);
    }
  });

  const startVoiceListening = async () => {
    try {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!result.granted) {
        console.log('Voice permission denied');
        return;
      }
      ExpoSpeechRecognitionModule.start({
        lang: 'en-IN',
        interimResults: true,
        continuous: true,
        androidIntentOptions: {
          EXTRA_LANGUAGE_MODEL: 'web_search',
        },
      });
      setVoiceActive(true);
    } catch (e) {
      console.log('Voice start error:', e);
      setVoiceActive(false);
    }
  };

  // ⏳ Countdown SOS
  const triggerSOSWithCountdown = () => {
    if (sosStatusRef.current !== 'idle') return;
    cancelSOS.current = false;
    setSosStatus('countdown');
    setCountdown(5);
    let count = 5;
    countdownInterval.current = setInterval(() => {
      count -= 1;
      setCountdown(count);
      if (count <= 0) {
        clearInterval(countdownInterval.current);
        if (!cancelSOS.current) sendSOS();
        else { setSosStatus('idle'); setCountdown(5); }
      }
    }, 1000);
  };

  const cancelSOSAlert = () => {
    cancelSOS.current = true;
    clearInterval(countdownInterval.current);
    Vibration.cancel();
    setSosStatus('idle');
    setCountdown(5);
    setTimeout(() => startVoiceListening(), 1000);
  };

  const getDistance = (lat1: number, lon1: number, lat2: number, lon2: number) => {
    const R = 6371000;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

const sendSOS = async () => {
  setSosStatus('sending');
  try {
    await triggerSOS('Manual SOS');
    setSosStatus('sent');
  } catch (e) {
    console.log('SOS error:', e);
    setSosStatus('idle');
  } finally {
    setTimeout(() => {
      setSosStatus('idle');
      startVoiceListening();
    }, 3000);
  }
};

  const sendBatteryAlert = async (pct: number) => {
  try {
    let locationStr = 'Unavailable';
    try {
      const loc = await Location.getCurrentPositionAsync({});
      locationStr = `https://maps.google.com/?q=${loc.coords.latitude},${loc.coords.longitude}`;
    } catch {
      const last = await getLastLocation();
      if (last) locationStr = `https://maps.google.com/?q=${last.lat},${last.lng}`;
    }
    // Use triggerSOS instead — it handles numbers + SMS internally
    await triggerSOS(`Battery Low ${pct}%`);
  } catch (e) { console.log('Battery alert error:', e); }
};

  const sendSafeZoneAlert = async (lat: number, lon: number) => {
  try {
    await triggerSOS('Safe Zone Exited');
  } catch (e) { console.log('Safe zone error:', e); }
};

  const getGreeting = () => {
    const h = new Date().getHours();
    if (h < 12) return { text: 'Good Morning', emoji: '🌅' };
    if (h < 17) return { text: 'Good Afternoon', emoji: '☀️' };
    return { text: 'Good Evening', emoji: '🌙' };
  };
  const greeting = getGreeting();

  if (!authReady) return null;

  return (
    <SafeAreaView style={styles.container}>

      {isOffline && (
        <View style={styles.offlineBanner}>
          <Text style={styles.offlineText}>📵 Offline — Using saved contacts</Text>
        </View>
      )}

      <View style={styles.header}>
        <Animated.View style={[styles.logoRow, { transform: [{ scale: shieldAnim }] }]}>
          <Text style={styles.shieldIcon}>🛡️</Text>
          <Text style={styles.appName}>SAKHI</Text>
        </Animated.View>
        <View style={styles.headerRight}>
          <View style={styles.protectedBadge}>
            <View style={styles.greenDot} />
            <Text style={styles.protectedText}>Protected</Text>
          </View>
          <TouchableOpacity onPress={async () => {
            await stopBackgroundProtection();
            await signOut(auth);
          }} style={styles.logoutBtn}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>

      <Text style={styles.greeting}>{greeting.text} {greeting.emoji}</Text>
      <Text style={styles.sub}>SAKHI is actively protecting you</Text>

      <View style={styles.statusRow}>
        <View style={[styles.chip, { borderColor: voiceActive ? '#4ade80' : '#222' }]}>
          <View style={[styles.dot, { backgroundColor: voiceActive ? '#4ade80' : '#444' }]} />
          <Text style={styles.chipText}>🎤 Voice</Text>
        </View>
        <View style={[styles.chip, { borderColor: batteryLevel && batteryLevel <= 20 ? '#f97316' : '#222' }]}>
          <Text style={styles.chipText}>🔋 {batteryLevel ?? '...'}%</Text>
        </View>
        <View style={[styles.chip, { borderColor: safeZone ? '#4ade80' : '#222' }]}>
          <View style={[styles.dot, { backgroundColor: safeZone ? '#4ade80' : '#444' }]} />
          <Text style={styles.chipText}>📍 Zone</Text>
        </View>
        <View style={[styles.chip, { borderColor: isOffline ? '#f97316' : '#4ade80' }]}>
          <Text style={styles.chipText}>{isOffline ? '📵' : '🌐'}</Text>
        </View>
      </View>

      <View style={styles.centerSection}>
        <Animated.View style={[styles.outerRing, { transform: [{ scale: pulseAnim }] }]}>
          <View style={styles.innerRing}>
            <Text style={styles.bigShield}>🛡️</Text>
            <Text style={styles.activeText}>ACTIVE</Text>
            <Text style={styles.activeSubText}>Always watching</Text>
          </View>
        </Animated.View>
        <View style={styles.triggersRow}>
          <View style={styles.triggerItem}>
            <Text style={styles.triggerIcon}>📳</Text>
            <Text style={styles.triggerLabel}>Shake</Text>
          </View>
          <View style={styles.triggerItem}>
            <Text style={[styles.triggerIcon, { opacity: voiceActive ? 1 : 0.3 }]}>🎤</Text>
            <Text style={styles.triggerLabel}>Voice</Text>
          </View>
          <View style={styles.triggerItem}>
            <Text style={styles.triggerIcon}>📉</Text>
            <Text style={styles.triggerLabel}>Fall</Text>
          </View>
        </View>
      </View>

      {sosStatus === 'countdown' && (
        <View style={styles.countdownBox}>
          <Text style={styles.countdownNum}>{countdown}</Text>
          <Text style={styles.countdownLabel}>SOS sending in {countdown}s...</Text>
          <TouchableOpacity style={styles.cancelBtn} onPress={cancelSOSAlert}>
            <Text style={styles.cancelText}>✕ CANCEL SOS</Text>
          </TouchableOpacity>
        </View>
      )}
      {sosStatus === 'sending' && (
        <View style={styles.countdownBox}>
          <Text style={styles.sendingText}>⏳ Sending SOS...</Text>
        </View>
      )}
      {sosStatus === 'sent' && (
        <View style={[styles.countdownBox, { borderColor: '#4ade80' }]}>
          <Text style={styles.sentText}>✅ SOS Sent!</Text>
        </View>
      )}

      <View style={styles.grid}>
        <TouchableOpacity style={[styles.card, styles.cardA]} onPress={() => router.push('/(tabs)/map')}>
          <Text style={styles.cardIcon}>🗺️</Text>
          <Text style={styles.cardTitle}>Live GPS</Text>
          <Text style={styles.cardSub}>Real-time tracking</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.card, styles.cardB]} onPress={() => router.push('/(tabs)/map')}>
          <Text style={styles.cardIcon}>🛡️</Text>
          <Text style={styles.cardTitle}>Safe Route</Text>
          <Text style={styles.cardSub}>AI path planner</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.card, styles.cardC]} onPress={() => router.push('/(tabs)/fakecall')}>
          <Text style={styles.cardIcon}>📞</Text>
          <Text style={styles.cardTitle}>Fake Call</Text>
          <Text style={styles.cardSub}>Escape situations</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.card, styles.cardD]} onPress={() => router.push('/(tabs)/profile')}>
          <Text style={styles.cardIcon}>👥</Text>
          <Text style={styles.cardTitle}>Guardians</Text>
          <Text style={styles.cardSub}>Manage contacts</Text>
        </TouchableOpacity>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080810', paddingHorizontal: 18, paddingTop: 4 },
  offlineBanner: {
    backgroundColor: '#431407', borderRadius: 10, paddingVertical: 7,
    paddingHorizontal: 14, marginBottom: 10, borderWidth: 1,
    borderColor: '#f97316', alignItems: 'center',
  },
  offlineText: { color: '#fb923c', fontSize: 12, fontWeight: '600' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, paddingTop: 4 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  shieldIcon: { fontSize: 22 },
  appName: { fontSize: 22, fontWeight: '800', color: '#fff', letterSpacing: 3 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  protectedBadge: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#0d2010',
    borderWidth: 1, borderColor: '#4ade80', paddingHorizontal: 10,
    paddingVertical: 5, borderRadius: 20, gap: 5,
  },
  greenDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#4ade80' },
  protectedText: { color: '#4ade80', fontSize: 11, fontWeight: '600' },
  logoutBtn: {
    backgroundColor: '#1a0a0f', borderWidth: 1, borderColor: '#e11d48',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
  },
  logoutText: { color: '#e11d48', fontSize: 11, fontWeight: '600' },
  greeting: { fontSize: 24, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },
  sub: { fontSize: 12, color: '#555', marginTop: 2, marginBottom: 14, letterSpacing: 0.3 },
  statusRow: { flexDirection: 'row', gap: 8, marginBottom: 20, flexWrap: 'wrap' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    backgroundColor: '#0f0f1a', borderWidth: 1, borderRadius: 20,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  dot: { width: 6, height: 6, borderRadius: 3 },
  chipText: { color: '#aaa', fontSize: 11, fontWeight: '500' },
  centerSection: { alignItems: 'center', marginBottom: 20 },
  outerRing: {
    width: 170, height: 170, borderRadius: 85,
    borderWidth: 2, borderColor: '#1a3a2a',
    backgroundColor: '#0a1a10',
    justifyContent: 'center', alignItems: 'center',
    shadowColor: '#4ade80', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3, shadowRadius: 20, elevation: 10,
  },
  innerRing: {
    width: 130, height: 130, borderRadius: 65,
    borderWidth: 1, borderColor: '#4ade8044',
    backgroundColor: '#0f2a18',
    justifyContent: 'center', alignItems: 'center',
  },
  bigShield: { fontSize: 40, marginBottom: 4 },
  activeText: { color: '#4ade80', fontSize: 13, fontWeight: '800', letterSpacing: 3 },
  activeSubText: { color: '#4ade8077', fontSize: 10, marginTop: 2 },
  triggersRow: { flexDirection: 'row', gap: 28, marginTop: 16 },
  triggerItem: { alignItems: 'center', gap: 4 },
  triggerIcon: { fontSize: 22 },
  triggerLabel: { color: '#555', fontSize: 10, fontWeight: '600', letterSpacing: 1 },
  countdownBox: {
    position: 'absolute', top: '35%', left: 20, right: 20,
    backgroundColor: '#1a0a0a', borderWidth: 2, borderColor: '#e11d48',
    borderRadius: 20, padding: 24, alignItems: 'center', zIndex: 99,
    shadowColor: '#e11d48', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8, shadowRadius: 20, elevation: 20,
  },
  countdownNum: { fontSize: 64, fontWeight: '900', color: '#e11d48' },
  countdownLabel: { color: '#fff', fontSize: 16, fontWeight: '600', marginBottom: 16 },
  cancelBtn: { backgroundColor: '#e11d48', paddingHorizontal: 28, paddingVertical: 12, borderRadius: 30 },
  cancelText: { color: '#fff', fontSize: 14, fontWeight: '800', letterSpacing: 1 },
  sendingText: { color: '#f97316', fontSize: 20, fontWeight: '700' },
  sentText: { color: '#4ade80', fontSize: 20, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { width: (width - 48) / 2, borderRadius: 18, padding: 16, minHeight: 100, borderWidth: 1 },
  cardA: { backgroundColor: '#071828', borderColor: '#0e3a5c' },
  cardB: { backgroundColor: '#0e0720', borderColor: '#2d1a5c' },
  cardC: { backgroundColor: '#071a0f', borderColor: '#0e3a20' },
  cardD: { backgroundColor: '#1a0e07', borderColor: '#3a200e' },
  cardIcon: { fontSize: 26, marginBottom: 8 },
  cardTitle: { fontSize: 14, fontWeight: '700', color: '#fff', marginBottom: 3 },
  cardSub: { fontSize: 11, color: '#666' },
});