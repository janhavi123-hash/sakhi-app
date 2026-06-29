import { Tabs } from 'expo-router';
import { Text, TouchableOpacity, Alert } from 'react-native';
import { triggerSOS } from '../../utils/backgroundService';

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
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🏠</Text> }} />
      <Tabs.Screen name="map" options={{ title: 'Map', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>🗺️</Text> }} />
      <Tabs.Screen
        name="sos"
        options={{
          title: 'SOS',
          tabBarIcon: () => <Text style={{ fontSize: 20 }}>🚨</Text>,
          tabBarButton: () => (
            <TouchableOpacity
              style={{
                flex: 1, alignItems: 'center', justifyContent: 'center',
                backgroundColor: '#e63946', borderRadius: 12, margin: 6,
              }}
              onPress={() => {
                Alert.alert(
                  '🚨 SOS Emergency',
                  'This will send your location to all guardians immediately!',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'SEND SOS 🚨', style: 'destructive', onPress: () => triggerSOS('Manual SOS') }
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
      <Tabs.Screen name="fakecall" options={{ title: 'Fake Call', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>📞</Text> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ color }) => <Text style={{ fontSize: 20, color }}>👤</Text> }} />
    </Tabs>
  );
}