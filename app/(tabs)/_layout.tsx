import { Tabs } from 'expo-router';
import { Text, TouchableOpacity, Alert, PermissionsAndroid, Platform } from 'react-native';
import * as Location from 'expo-location';
import { auth, db } from '../../config/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { SendDirectSms } from 'react-native-send-direct-sms';
import { getGuardiansOffline } from '../../utils/guardianStorage';
import NetInfo from '@react-native-community/netinfo';

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

async function triggerSOS() {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Error', 'Location permission denied.');
      return;
    }

    const user = auth.currentUser;
    if (!user) {
      Alert.alert('Error', 'Please login first.');
      return;
    }

    let lat: number;
    let lng: number;
    try {
      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });
      lat = loc.coords.latitude;
      lng = loc.coords.longitude;
    } catch {
      Alert.alert('Error', 'Could not get location. Please try again.');
      return;
    }

    const numbers = await getNumbers();
    if (!numbers.length) {
      Alert.alert('No Guardians', 'Please add guardians in Profile tab first.');
      return;
    }

    const hasPermission = await requestSmsPermission();
    if (!hasPermission) {
      Alert.alert('Permission Denied', 'SMS permission is required to send SOS.');
      return;
    }

    const message = `🚨 SOS EMERGENCY!\nI need immediate help!\nMy location:\nhttps://maps.google.com/?q=${lat},${lng}\n- Sent from SAKHI app`;

    for (const number of numbers) {
      try {
        await SendDirectSms(number, message);
      } catch (e) {
        console.log('SMS error for', number, ':', e);
      }
    }

    Alert.alert('🚨 SOS Sent!', `Emergency alert sent to ${numbers.length} guardian(s)!`);

  } catch (e) {
    Alert.alert('Error', 'Could not send SOS. Please try again.');
  }
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0f0f1f',
          borderTopColor: '#1a1a2e',
          paddingBottom: 20,
          paddingTop: 8,
          height: 85,
        },
        tabBarActiveTintColor: '#e11d48',
        tabBarInactiveTintColor: '#555',
        tabBarLabelStyle: { fontSize: 11, marginTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 20, color }}>🏠</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Map',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 20, color }}>🗺️</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="sos"
        options={{
          title: 'SOS',
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>🚨</Text>,
          tabBarButton: () => (
            <TouchableOpacity
              style={{
                flex: 1,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: '#e63946',
                borderRadius: 12,
                margin: 6,
              }}
              onPress={() => {
                Alert.alert(
                  '🚨 SOS Emergency',
                  'This will send your location to all guardians immediately!',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'SEND SOS 🚨', style: 'destructive', onPress: triggerSOS }
                  ]
                );
              }}
            >
              <Text style={{ fontSize: 22 }}>🚨</Text>
              <Text style={{ color: '#fff', fontSize: 11, fontWeight: 'bold' }}>SOS</Text>
            </TouchableOpacity>
          ),
        }}
      />
      <Tabs.Screen
        name="fakecall"
        options={{
          title: 'Fake Call',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 20, color }}>📞</Text>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color }) => (
            <Text style={{ fontSize: 20, color }}>👤</Text>
          ),
        }}
      />
    </Tabs>
  );
}