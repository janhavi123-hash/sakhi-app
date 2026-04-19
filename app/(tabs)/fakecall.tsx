import { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  Vibration, Animated, StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Audio } from 'expo-av';
import * as Speech from 'expo-speech';
import { auth, db } from '../../config/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { Ionicons } from '@expo/vector-icons';

type Guardian = { id: string; name: string; phone: string; };

// 🎤 Realistic conversation lines spoken by TTS
const CONVERSATION_LINES = [
  { text: "Hello? Are you okay?", delay: 1000 },
  { text: "I was just thinking about you. Where are you right now?", delay: 6000 },
  { text: "Okay okay, I am coming. Just stay where you are.", delay: 14000 },
  { text: "Do not worry. I will be there in 10 minutes.", delay: 22000 },
  { text: "Just keep talking to me. Are you safe?", delay: 30000 },
];

export default function FakeCallScreen() {
  const [callState, setCallState] = useState<'idle' | 'ringing' | 'active'>('idle');
  const [caller, setCaller] = useState<Guardian | null>(null);
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [duration, setDuration] = useState(0);
  const [delay, setDelay] = useState('5');
  const [loading, setLoading] = useState(true);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const soundRef = useRef<Audio.Sound | null>(null);
  const speechTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    fetchGuardians();
    return () => {
      stopEverything();
    };
  }, []);

  useEffect(() => {
    if (callState === 'ringing') {
      playRingtone();
      Vibration.vibrate([500, 1000, 500, 1000], true);
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.12, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      stopSound();
      Vibration.cancel();
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }

    if (callState === 'active') {
      // Start call timer
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
      // Start TTS conversation
      startConversation();
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
      setDuration(0);
      stopConversation();
    }
  }, [callState]);

  const fetchGuardians = async () => {
    const user = auth.currentUser;
    if (!user) return;
    const q = query(collection(db, 'guardians'), where('uid', '==', user.uid));
    const snap = await getDocs(q);
    const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Guardian[];
    setGuardians(data);
    setLoading(false);
  };

  const playRingtone = async () => {
    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: false,
      });
      const { sound } = await Audio.Sound.createAsync(
        require('../../assets/sound/ringtone.mp3'),
        { isLooping: true, volume: 1.0 }
      );
      soundRef.current = sound;
      await sound.playAsync();
    } catch (e) {
      console.log('Ringtone error:', e);
    }
  };

  const stopSound = async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
        soundRef.current = null;
      }
    } catch {}
  };

  // 🎤 TTS Conversation — plays line by line with delays
  const startConversation = () => {
    // Set audio to speaker so voice is heard clearly
    Audio.setAudioModeAsync({
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: false,
    });

    CONVERSATION_LINES.forEach(({ text, delay }) => {
      const t = setTimeout(() => {
        if (!muted) {
          Speech.speak(text, {
            language: 'en-IN',
            pitch: 1.1,
            rate: 0.9,
          });
        }
      }, delay);
      speechTimers.current.push(t);
    });
  };

  const stopConversation = () => {
    Speech.stop();
    speechTimers.current.forEach(t => clearTimeout(t));
    speechTimers.current = [];
  };

  const stopEverything = () => {
    stopSound();
    stopConversation();
    Vibration.cancel();
    if (timerRef.current) clearInterval(timerRef.current);
  };

  const startFakeCall = () => {
    if (guardians.length === 0) return;
    setCaller(guardians[selectedIndex]);
    const secs = parseInt(delay) || 5;
    setTimeout(() => setCallState('ringing'), secs * 1000);
  };

  const answerCall = () => {
    setMuted(false);
    setSpeaker(false);
    setCallState('active');
  };

  const endCall = () => {
    stopEverything();
    setCallState('idle');
  };

  const formatDuration = (secs: number) => {
    const m = Math.floor(secs / 60).toString().padStart(2, '0');
    const s = (secs % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const CallerAvatar = ({ size = 120 }: { size?: number }) => (
    <Animated.View style={[
      styles.avatarOuter,
      { width: size + 20, height: size + 20, borderRadius: (size + 20) / 2 },
      callState === 'ringing' && { transform: [{ scale: pulseAnim }] }
    ]}>
      <View style={[styles.avatarInner, { width: size, height: size, borderRadius: size / 2 }]}>
        <Text style={[styles.avatarLetter, { fontSize: size * 0.45 }]}>
          {caller?.name?.charAt(0).toUpperCase()}
        </Text>
      </View>
    </Animated.View>
  );

  // ─── IDLE SCREEN ─────────────────────────────────────────
  if (callState === 'idle') {
    return (
      <SafeAreaView style={styles.idleContainer}>
        <Text style={styles.title}>📞 Fake Call</Text>
        <Text style={styles.sub}>Simulate a real incoming call from your guardian</Text>

        {loading ? (
          <Text style={styles.loadingText}>Loading guardians...</Text>
        ) : guardians.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>No guardians found!</Text>
            <Text style={styles.emptySubText}>Add guardians in Profile tab first.</Text>
          </View>
        ) : (
          <>
            <Text style={styles.label}>Choose who is calling:</Text>
            {guardians.map((g, i) => (
              <TouchableOpacity
                key={g.id}
                style={[styles.callerOption, selectedIndex === i && styles.callerSelected]}
                onPress={() => setSelectedIndex(i)}
              >
                <View style={styles.callerAvatar}>
                  <Text style={styles.callerAvatarText}>{g.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.callerName}>{g.name}</Text>
                  <Text style={styles.callerPhone}>{g.phone}</Text>
                </View>
                {selectedIndex === i && <Text style={styles.checkMark}>✅</Text>}
              </TouchableOpacity>
            ))}

            <Text style={styles.label}>Call after (seconds):</Text>
            <View style={styles.delayRow}>
              {['3', '5', '10', '30'].map(d => (
                <TouchableOpacity
                  key={d}
                  style={[styles.delayBtn, delay === d && styles.delaySelected]}
                  onPress={() => setDelay(d)}
                >
                  <Text style={[styles.delayText, delay === d && styles.delayTextSelected]}>{d}s</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity style={styles.startBtn} onPress={startFakeCall}>
              <Text style={styles.startBtnText}>📲 Start Fake Call</Text>
            </TouchableOpacity>
            <Text style={styles.tip}>💡 Put phone in pocket — rings in {delay}s</Text>
          </>
        )}
      </SafeAreaView>
    );
  }

  // ─── RINGING SCREEN ──────────────────────────────────────
  if (callState === 'ringing') {
    return (
      <View style={{ flex: 1, backgroundColor: '#13122a' }}>
        <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
        <SafeAreaView style={styles.callWrapper}>
          <Text style={styles.incomingLabel}>Incoming call</Text>
          <CallerAvatar size={120} />
          <Text style={styles.callerBigName}>{caller?.name}</Text>
          <Text style={styles.callerBigNumber}>{caller?.phone}</Text>
          <Text style={styles.mobileGuardianLabel}>Mobile • Guardian</Text>
          <View style={{ flex: 1 }} />
          <View style={styles.ringBtnRow}>
            <View style={styles.ringBtnGroup}>
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <TouchableOpacity style={styles.declineBtn} onPress={endCall}>
                  <Ionicons name="call" size={32} color="#fff"
                    style={{ transform: [{ rotate: '135deg' }] }} />
                </TouchableOpacity>
              </Animated.View>
              <Text style={styles.ringBtnLabel}>Decline</Text>
            </View>
            <View style={styles.ringBtnGroup}>
              <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
                <TouchableOpacity style={styles.answerBtn} onPress={answerCall}>
                  <Ionicons name="call" size={32} color="#fff" />
                </TouchableOpacity>
              </Animated.View>
              <Text style={styles.ringBtnLabel}>Answer</Text>
            </View>
          </View>
          <View style={{ height: 30 }} />
        </SafeAreaView>
      </View>
    );
  }

  // ─── ACTIVE CALL SCREEN ──────────────────────────────────
  return (
    <View style={{ flex: 1, backgroundColor: '#13122a' }}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />
      <SafeAreaView style={styles.callWrapper}>
        <Text style={styles.callTimer}>{formatDuration(duration)}</Text>
        <CallerAvatar size={120} />
        <Text style={styles.callerBigName}>{caller?.name}</Text>
        <Text style={styles.callerBigNumber}>{caller?.phone}</Text>
        <Text style={styles.mobileGuardianLabel}>Mobile • Guardian</Text>
        <View style={{ flex: 1 }} />

        <View style={styles.gridContainer}>
          <View style={styles.gridRow}>
            <TouchableOpacity
              style={[styles.gridCircle, muted && styles.gridCircleActive]}
              onPress={() => {
                const newMuted = !muted;
                setMuted(newMuted);
                if (newMuted) Speech.stop();
              }}
            >
              <Ionicons name={muted ? 'mic-off' : 'mic-off-outline'} size={26}
                color={muted ? '#e63946' : '#ccc'} />
              <Text style={styles.gridLabel}>Mute</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.gridCircle}>
              <Ionicons name="keypad-outline" size={26} color="#ccc" />
              <Text style={styles.gridLabel}>Keypad</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.gridCircle, speaker && styles.gridCircleActive]}
              onPress={() => setSpeaker(s => !s)}
            >
              <Ionicons name={speaker ? 'volume-high' : 'volume-high-outline'} size={26}
                color={speaker ? '#4ade80' : '#ccc'} />
              <Text style={styles.gridLabel}>Speaker</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.gridRow}>
            <TouchableOpacity style={styles.gridCircle}>
              <Ionicons name="add" size={26} color="#ccc" />
              <Text style={styles.gridLabel}>Add call</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.gridCircle}>
              <Ionicons name="videocam-outline" size={26} color="#ccc" />
              <Text style={styles.gridLabel}>Video</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.gridCircle}>
              <Ionicons name="person-outline" size={26} color="#ccc" />
              <Text style={styles.gridLabel}>Contacts</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.endCallBtn} onPress={endCall}>
          <Ionicons name="call" size={32} color="#fff"
            style={{ transform: [{ rotate: '135deg' }] }} />
        </TouchableOpacity>
        <View style={{ height: 30 }} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  idleContainer: { flex: 1, backgroundColor: '#0d0d1a', padding: 24 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#fff', textAlign: 'center', marginBottom: 6 },
  sub: { fontSize: 13, color: '#888', textAlign: 'center', marginBottom: 24 },
  loadingText: { color: '#888', textAlign: 'center', marginTop: 40 },
  emptyBox: { backgroundColor: '#111128', borderRadius: 16, padding: 24, alignItems: 'center', marginTop: 20 },
  emptyText: { color: '#e63946', fontSize: 16, fontWeight: 'bold', marginBottom: 8 },
  emptySubText: { color: '#888', fontSize: 13, textAlign: 'center' },
  label: { color: '#aaa', fontSize: 14, marginBottom: 10, marginTop: 8 },
  callerOption: { backgroundColor: '#111128', borderRadius: 14, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: '#1a1a2e' },
  callerSelected: { borderColor: '#e63946', backgroundColor: '#1a0a10' },
  callerAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e63946', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  callerAvatarText: { color: '#fff', fontWeight: 'bold', fontSize: 18 },
  callerName: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  callerPhone: { color: '#888', fontSize: 12, marginTop: 2 },
  checkMark: { fontSize: 18 },
  delayRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  delayBtn: { flex: 1, backgroundColor: '#111128', borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#1a1a2e' },
  delaySelected: { borderColor: '#e63946', backgroundColor: '#1a0a10' },
  delayText: { color: '#888', fontWeight: 'bold' },
  delayTextSelected: { color: '#e63946' },
  startBtn: { backgroundColor: '#e63946', borderRadius: 14, padding: 18, alignItems: 'center' },
  startBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 17 },
  tip: { color: '#555', fontSize: 12, textAlign: 'center', marginTop: 16 },
  callWrapper: { flex: 1, alignItems: 'center', paddingTop: 20 },
  incomingLabel: { color: '#aaa', fontSize: 16, marginBottom: 28, marginTop: 8 },
  callTimer: { color: '#4ade80', fontSize: 22, fontWeight: 'bold', marginBottom: 24, marginTop: 8 },
  avatarOuter: { backgroundColor: 'rgba(229,57,53,0.18)', alignItems: 'center', justifyContent: 'center', marginBottom: 20 },
  avatarInner: { backgroundColor: '#e05555', alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: '#fff', fontWeight: 'bold' },
  callerBigName: { color: '#fff', fontSize: 34, fontWeight: 'bold', marginBottom: 8, textAlign: 'center' },
  callerBigNumber: { color: '#aaa', fontSize: 17, marginBottom: 4, textAlign: 'center' },
  mobileGuardianLabel: { color: '#666', fontSize: 13, textAlign: 'center' },
  ringBtnRow: { flexDirection: 'row', justifyContent: 'space-around', width: '80%', marginBottom: 16 },
  ringBtnGroup: { alignItems: 'center', gap: 12 },
  declineBtn: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#e53935', alignItems: 'center', justifyContent: 'center', elevation: 8, shadowColor: '#e53935', shadowOpacity: 0.5, shadowRadius: 12 },
  answerBtn: { width: 76, height: 76, borderRadius: 38, backgroundColor: '#43a047', alignItems: 'center', justifyContent: 'center', elevation: 8, shadowColor: '#43a047', shadowOpacity: 0.5, shadowRadius: 12 },
  ringBtnLabel: { color: '#fff', fontSize: 14, fontWeight: '500' },
  gridContainer: { width: '90%', gap: 16, marginBottom: 32 },
  gridRow: { flexDirection: 'row', justifyContent: 'space-around' },
  gridCircle: { width: 82, height: 82, borderRadius: 41, backgroundColor: '#1e1d35', alignItems: 'center', justifyContent: 'center', gap: 4, elevation: 4 },
  gridCircleActive: { backgroundColor: '#2a2945' },
  gridLabel: { color: '#bbb', fontSize: 11, fontWeight: '500', marginTop: 2 },
  endCallBtn: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#e53935', alignItems: 'center', justifyContent: 'center', marginBottom: 8, elevation: 8, shadowColor: '#e53935', shadowOpacity: 0.6, shadowRadius: 12 },
});