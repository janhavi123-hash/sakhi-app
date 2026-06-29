import { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, Alert, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { auth, db } from '../../config/firebase';
import { signOut } from 'firebase/auth';
import {
  collection, addDoc, deleteDoc,
  doc, onSnapshot, query, where, getDoc
} from 'firebase/firestore';
import { useRouter } from 'expo-router';
import { saveGuardiansOffline } from '../../utils/guardianStorage';
import { triggerSOS, setTriggerCallback } from '../../utils/backgroundService';

type Guardian = { id: string; name: string; phone: string; };

export default function ProfileScreen() {
  const [guardians, setGuardians] = useState<Guardian[]>([]);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [userName, setUserName] = useState('');
  const router = useRouter();
  const user = auth.currentUser;

  useEffect(() => {
  setTriggerCallback((reason) => {
    triggerSOS(reason);
  });
  return () => setTriggerCallback(() => {});
}, []);

  useEffect(() => {
    if (!user) return;

    const fetchName = async () => {
      const docRef = doc(db, 'users', user.uid);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        setUserName(docSnap.data().name || '');
      }
    };
    fetchName();

    const q = query(collection(db, 'guardians'), where('uid', '==', user.uid));
    const unsub = onSnapshot(q, async (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Guardian[];
      setGuardians(data);
      await saveGuardiansOffline(data);
    });
    return () => unsub();
  }, []);

  const addGuardian = async () => {
  if (!name || !phone) {
    Alert.alert('Error', 'Please enter both name and phone number.');
    return;
  }
 const digitsOnly = phone.replace(/\D/g, '');
const localNumber = digitsOnly.startsWith('91') ? digitsOnly.slice(2) : digitsOnly;
if (localNumber.length !== 10) {
  Alert.alert('Error', 'Please enter a valid 10-digit mobile number (with or without country code 91).');
  return;
}
  if (guardians.length >= 5) {
    Alert.alert('Error', 'Maximum 5 guardians allowed.');
    return;
  }
  if (!user) return;

  const formattedPhone = phone.startsWith('+') ? phone : '+' + phone;
  setName('');
  setPhone('');

  await addDoc(collection(db, 'guardians'), { uid: user.uid, name, phone: formattedPhone });
  // onSnapshot already listening — UI updates automatically when Firestore confirms
};

  const deleteGuardian = async (id: string) => {
    Alert.alert('Remove Guardian', 'Are you sure?', [
      { text: 'Cancel' },
      {
        text: 'Remove', style: 'destructive',
        onPress: async () => await deleteDoc(doc(db, 'guardians', id))
      }
    ]);
  };

  const handleLogout = async () => {
    await signOut(auth);
    router.replace('/login');
  };

  const getInitials = () => {
    if (userName) return userName.charAt(0).toUpperCase();
    if (user?.email) return user.email.charAt(0).toUpperCase();
    return '?';
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>

        <View style={styles.profileCard}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>{getInitials()}</Text>
          </View>
          <Text style={styles.userName}>{userName || 'SAKHI User'}</Text>
          <Text style={styles.userEmail}>{user?.email}</Text>
          <View style={styles.statusRow}>
            <View style={styles.greenDot} />
            <Text style={styles.statusText}>Protected & Safe</Text>
          </View>
          <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
            <Text style={styles.logoutText}>🚪 Logout</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>{guardians.length}</Text>
            <Text style={styles.statLabel}>Guardians</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>24/7</Text>
            <Text style={styles.statLabel}>Protection</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>🟢</Text>
            <Text style={styles.statLabel}>Online</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>👥 My Guardians</Text>
        <Text style={styles.sub}>They will receive your SOS & location</Text>

        <View style={styles.inputBox}>
          <TextInput
            style={styles.input}
            placeholder="Guardian Name"
            placeholderTextColor="#555"
            value={name}
            onChangeText={setName}
          />
          <TextInput
  style={[styles.input, { height: 50 }]}
  placeholder="Phone e.g. 919876543210"
  placeholderTextColor="#888"
  value={phone}
  onChangeText={setPhone}
  keyboardType="phone-pad"
/>
          <TouchableOpacity style={styles.addBtn} onPress={addGuardian} disabled={loading}>
            <Text style={styles.addBtnText}>{loading ? 'Adding...' : '+ Add Guardian'}</Text>
          </TouchableOpacity>
        </View>

        {guardians.length === 0 ? (
          <Text style={styles.empty}>No guardians yet. Add someone you trust! 💙</Text>
        ) : (
          guardians.map(item => (
            <View key={item.id} style={styles.card}>
              <View style={styles.cardAvatar}>
                <Text style={styles.cardAvatarText}>{item.name.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardName}>{item.name}</Text>
                <Text style={styles.cardPhone}>📞 {item.phone}</Text>
              </View>
              <TouchableOpacity onPress={() => deleteGuardian(item.id)}>
                <Text style={styles.deleteBtn}>🗑️</Text>
              </TouchableOpacity>
            </View>
          ))
        )}

        <View style={{ height: 30 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a1a', padding: 20 },
  profileCard: { alignItems: 'center', backgroundColor: '#111128', borderRadius: 20, padding: 24, marginBottom: 16 },
  avatarCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#e63946', alignItems: 'center', justifyContent: 'center', marginBottom: 12, borderWidth: 3, borderColor: '#ff6b7a' },
  avatarText: { color: '#fff', fontSize: 34, fontWeight: 'bold' },
  userName: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 4 },
  userEmail: { color: '#888', fontSize: 13, marginBottom: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  greenDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#4ade80', marginRight: 6 },
  statusText: { color: '#4ade80', fontSize: 13 },
  logoutBtn: { backgroundColor: '#1a0a10', paddingHorizontal: 24, paddingVertical: 10, borderRadius: 20, borderWidth: 1, borderColor: '#e63946' },
  logoutText: { color: '#e63946', fontWeight: 'bold' },
  statsRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  statBox: { flex: 1, backgroundColor: '#111128', borderRadius: 14, padding: 16, alignItems: 'center' },
  statNumber: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 4 },
  statLabel: { color: '#888', fontSize: 12 },
  sectionTitle: { fontSize: 20, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  sub: { fontSize: 13, color: '#888', marginBottom: 16 },
  inputBox: { backgroundColor: '#111128', borderRadius: 16, padding: 16, marginBottom: 20 },
  input: { backgroundColor: '#1a1a2e', color: '#fff', borderRadius: 10, padding: 12, marginBottom: 10, fontSize: 14 },
  addBtn: { backgroundColor: '#e63946', borderRadius: 10, padding: 14, alignItems: 'center' },
  addBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  card: { backgroundColor: '#111128', borderRadius: 14, padding: 16, marginBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#e63946', alignItems: 'center', justifyContent: 'center' },
  cardAvatarText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  cardName: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  cardPhone: { color: '#888', fontSize: 13, marginTop: 4 },
  deleteBtn: { fontSize: 22 },
  empty: { color: '#555', textAlign: 'center', marginTop: 20, fontSize: 14 },
});