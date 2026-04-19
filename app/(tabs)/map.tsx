import { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, TextInput, Linking, Modal, FlatList } from 'react-native';
import MapView, { Marker, UrlTile, Polyline } from 'react-native-maps';
import * as Location from 'expo-location';
import * as SMS from 'expo-sms';
import { auth, db } from '../../config/firebase';
import { collection, query, where, getDocs } from 'firebase/firestore';

type Place = {
  id: string;
  name: string;
  lat: number;
  lon: number;
  type: 'police' | 'hospital';
  phone?: string;
};

type Coord = { latitude: number; longitude: number };

export default function MapScreen() {
  const [location, setLocation] = useState<Coord | null>(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [sending, setSending] = useState(false);
  const [places, setPlaces] = useState<Place[]>([]);
  const [walkActive, setWalkActive] = useState(false);
  const [walkSeconds, setWalkSeconds] = useState(0);
  const [destination, setDestination] = useState('');
  const [destCoord, setDestCoord] = useState<Coord | null>(null);
  const [routeCoords, setRouteCoords] = useState<Coord[]>([]);
  const [showWalkModal, setShowWalkModal] = useState(false);
  const [showPlacesModal, setShowPlacesModal] = useState(false);
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [timerMinutes, setTimerMinutes] = useState('15');
  const [sosTriggered, setSosTriggered] = useState(false);
  const mapRef = useRef<MapView>(null);
  const walkTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let subscriber: Location.LocationSubscription;
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permission denied. Please allow location access.');
        return;
      }
      subscriber = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 3000, distanceInterval: 5 },
        (loc) => { setLocation(loc.coords); }
      );
    })();
    return () => {
      if (subscriber) subscriber.remove();
      if (walkTimer.current) clearInterval(walkTimer.current);
    };
  }, []);

  const searchDestination = async () => {
    if (!destination.trim()) return;
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(destination)}&format=json&limit=5`,
        { headers: { 'User-Agent': 'SakhiApp/1.0' } }
      );
      const data = await res.json();
      setSearchResults(data);
    } catch {
      Alert.alert('Error', 'Could not search location. Check internet.');
    }
  };

  const selectDestination = async (item: any) => {
    const coord = { latitude: parseFloat(item.lat), longitude: parseFloat(item.lon) };
    setDestCoord(coord);
    setDestination(item.display_name.split(',')[0]);
    setSearchResults([]);
    await fetchRoute(coord);
    mapRef.current?.fitToCoordinates([location!, coord], {
      edgePadding: { top: 80, right: 40, bottom: 150, left: 40 },
      animated: true,
    });
  };

  const fetchRoute = async (dest: Coord) => {
    if (!location) return;
    try {
      const res = await fetch(
        `https://router.project-osrm.org/route/v1/foot/${location.longitude},${location.latitude};${dest.longitude},${dest.latitude}?overview=full&geometries=geojson`
      );
      const data = await res.json();
      if (data.routes && data.routes.length > 0) {
        const coords = data.routes[0].geometry.coordinates.map((c: number[]) => ({
          latitude: c[1],
          longitude: c[0],
        }));
        setRouteCoords(coords);
        const mins = Math.ceil(data.routes[0].duration / 60);
        setTimerMinutes(String(mins + 5));
      }
    } catch {
      Alert.alert('Error', 'Could not calculate route.');
    }
  };

  const startSafeWalk = () => {
    if (!destCoord) {
      Alert.alert('No Destination', 'Please search and select a destination first.');
      return;
    }
    const mins = parseInt(timerMinutes);
    if (isNaN(mins) || mins < 1) {
      Alert.alert('Invalid Time', 'Please enter a valid time in minutes.');
      return;
    }
    setShowWalkModal(false);
    setWalkActive(true);
    setSosTriggered(false);
    setWalkSeconds(mins * 60);
    walkTimer.current = setInterval(() => {
      setWalkSeconds(prev => {
        if (prev <= 1) {
          clearInterval(walkTimer.current!);
          setWalkActive(false);
          setSosTriggered(true);
          triggerSOS();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const triggerSOS = async () => {
    if (!location) return;
    const numbers = await getGuardianNumbers();
    if (numbers.length === 0) return;
    const isAvailable = await SMS.isAvailableAsync();
    if (!isAvailable) return;
    const message = `🚨 SOS! Safe Walk timer expired!\nI may be in danger at:\nhttps://maps.google.com/?q=${location.latitude},${location.longitude}\n- Sent from SAKHI app`;
    await SMS.sendSMSAsync(numbers, message);
  };

  const imSafe = () => {
    if (walkTimer.current) clearInterval(walkTimer.current);
    setWalkActive(false);
    setSosTriggered(false);
    setWalkSeconds(0);
    Alert.alert('✅ Glad you are safe!', 'Safe Walk mode ended.');
  };

  const getGuardianNumbers = async () => {
    const user = auth.currentUser;
    if (!user) return [];
    const q = query(collection(db, 'guardians'), where('uid', '==', user.uid));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data().phone);
  };

  const shareLocation = async () => {
    if (!location) { Alert.alert('Error', 'Location not found yet.'); return; }
    const numbers = await getGuardianNumbers();
    if (numbers.length === 0) {
      Alert.alert('No Guardians', 'Please add guardians in Profile tab first.');
      return;
    }
    const isAvailable = await SMS.isAvailableAsync();
    if (!isAvailable) return;
    setSending(true);
    const message = `🚨 EMERGENCY! I need help!\nMy location:\nhttps://maps.google.com/?q=${location.latitude},${location.longitude}\n- Sent from SAKHI app`;
    await SMS.sendSMSAsync(numbers, message);
    setSending(false);
    Alert.alert('✅ Sent!', `Location shared with ${numbers.length} guardian(s).`);
  };

  const fetchNearbyPlaces = async () => {
    if (!location) return;
    try {
      const { latitude, longitude } = location;
      const overpassQuery = `
        [out:json];
        (
          node["amenity"="police"](around:3000,${latitude},${longitude});
          node["amenity"="hospital"](around:3000,${latitude},${longitude});
        );
        out body 15;
      `;
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST', body: overpassQuery,
      });
      const data = await res.json();
      const fetched: Place[] = data.elements.map((el: any) => ({
        id: String(el.id),
        name: el.tags?.name || (el.tags?.amenity === 'police' ? 'Police Station' : 'Hospital'),
        lat: el.lat,
        lon: el.lon,
        type: el.tags?.amenity === 'police' ? 'police' : 'hospital',
        phone: el.tags?.phone || el.tags?.['contact:phone'] || null,
      }));
      setPlaces(fetched);
      setShowPlacesModal(true);
    } catch {
      Alert.alert('Error', 'Could not fetch nearby places.');
    }
  };

  const callPlace = (phone: string) => {
    Alert.alert('Call', `Call ${phone}?`, [
      { text: 'Cancel' },
      { text: 'Call', onPress: () => Linking.openURL(`tel:${phone}`) }
    ]);
  };

  const callEmergency = (number: string, name: string) => {
    Alert.alert(`Call ${name}`, `Are you sure you want to call ${number}?`, [
      { text: 'Cancel' },
      { text: 'Call Now 📞', style: 'destructive', onPress: () => Linking.openURL(`tel:${number}`) }
    ]);
  };

  const goToMyLocation = () => {
    if (location && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: location.latitude,
        longitude: location.longitude,
        latitudeDelta: 0.005,
        longitudeDelta: 0.005,
      }, 1000);
    }
  };

  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  if (errorMsg) return (
    <View style={styles.container}>
      <Text style={styles.error}>{errorMsg}</Text>
    </View>
  );

  if (!location) return (
    <View style={styles.container}>
      <Text style={styles.sub}>📍 Getting your location...</Text>
    </View>
  );

  return (
    <View style={styles.mapContainer}>
      <MapView
        ref={mapRef}
        style={styles.map}
        showsUserLocation={true}
        showsMyLocationButton={false}
        initialRegion={{
          latitude: location.latitude,
          longitude: location.longitude,
          latitudeDelta: 0.005,
          longitudeDelta: 0.005,
        }}
        mapType="none"
      >
        <UrlTile
          urlTemplate="https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png"
          maximumZ={19} flipY={false}
        />
        <Marker coordinate={location} title="You are here 📍" pinColor="#e63946" />
        {destCoord && (
          <Marker coordinate={destCoord} title="Destination 🏁" pinColor="#7c3aed" />
        )}
        {routeCoords.length > 0 && (
          <Polyline coordinates={routeCoords} strokeColor="#e63946" strokeWidth={4} />
        )}
        {places.map(place => (
          <Marker
            key={place.id}
            coordinate={{ latitude: place.lat, longitude: place.lon }}
            title={place.name}
            pinColor={place.type === 'police' ? '#1d4ed8' : '#16a34a'}
          />
        ))}
      </MapView>

      {/* Top badge */}
      <View style={styles.badge}>
        <Text style={styles.badgeText}>🔴 Live GPS</Text>
      </View>

      {/* My Location */}
      <TouchableOpacity style={styles.myLocationBtn} onPress={goToMyLocation}>
        <Text>📍</Text>
      </TouchableOpacity>

      {/* Safe Walk Timer */}
      {walkActive && (
        <View style={styles.timerBox}>
          <Text style={styles.timerText}>🚶‍♀️ {formatTime(walkSeconds)}</Text>
          <TouchableOpacity style={styles.safeBtn} onPress={imSafe}>
            <Text style={styles.safeBtnText}>✅ I'm Safe!</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* SOS Triggered */}
      {sosTriggered && (
        <View style={styles.sosBox}>
          <Text style={styles.sosText}>🚨 SOS Sent to Guardians!</Text>
          <View style={styles.callRow}>
            <TouchableOpacity style={styles.callBtn} onPress={() => callEmergency('100', 'Police')}>
              <Text style={styles.callBtnText}>📞 Call Police 100</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.callBtn, { backgroundColor: '#16a34a' }]} onPress={() => callEmergency('108', 'Ambulance')}>
              <Text style={styles.callBtnText}>📞 Call 108</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity onPress={() => setSosTriggered(false)}>
            <Text style={{ color: '#aaa', marginTop: 8 }}>I am safe, dismiss</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bottom Buttons */}
      <View style={styles.bottomBar}>
        <TouchableOpacity style={styles.smallBtn} onPress={fetchNearbyPlaces}>
          <Text style={styles.smallBtnText}>🏥 Nearby</Text>
        </TouchableOpacity>
        {!walkActive && (
          <TouchableOpacity style={styles.smallBtn} onPress={() => setShowWalkModal(true)}>
            <Text style={styles.smallBtnText}>🚶‍♀️ Safe Walk</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.shareBtn} onPress={shareLocation} disabled={sending}>
          <Text style={styles.shareBtnText}>{sending ? '...' : '📩 Share'}</Text>
        </TouchableOpacity>
      </View>

      {/* Safe Walk Modal */}
      <Modal visible={showWalkModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>🚶‍♀️ Safe Walk Setup</Text>

            <TextInput
              style={styles.modalInput}
              placeholder="Search destination..."
              placeholderTextColor="#555"
              value={destination}
              onChangeText={setDestination}
              onSubmitEditing={searchDestination}
              returnKeyType="search"
            />
            <TouchableOpacity style={styles.searchBtn} onPress={searchDestination}>
              <Text style={styles.searchBtnText}>🔍 Search</Text>
            </TouchableOpacity>

            {searchResults.map((item, i) => (
              <TouchableOpacity key={i} style={styles.resultItem} onPress={() => selectDestination(item)}>
                <Text style={styles.resultText} numberOfLines={2}>{item.display_name}</Text>
              </TouchableOpacity>
            ))}

            {destCoord && (
              <>
                <Text style={styles.destSelected}>✅ Destination: {destination}</Text>
                <Text style={styles.modalLabel}>⏱ Time limit (minutes):</Text>
                <TextInput
                  style={styles.modalInput}
                  value={timerMinutes}
                  onChangeText={setTimerMinutes}
                  keyboardType="numeric"
                  placeholderTextColor="#555"
                />
                <TouchableOpacity style={styles.startBtn} onPress={startSafeWalk}>
                  <Text style={styles.startBtnText}>🚶‍♀️ Start Safe Walk</Text>
                </TouchableOpacity>
              </>
            )}

            <TouchableOpacity onPress={() => { setShowWalkModal(false); setSearchResults([]); }}>
              <Text style={styles.cancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Nearby Places Modal */}
      <Modal visible={showPlacesModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>🏥 Nearby Safe Places</Text>
            <Text style={{ color: '#888', marginBottom: 10, fontSize: 12 }}>🔵 Police  🟢 Hospital</Text>

            {/* Emergency Numbers */}
            <View style={styles.callRow}>
              <TouchableOpacity style={styles.callBtn} onPress={() => callEmergency('100', 'Police')}>
                <Text style={styles.callBtnText}>📞 Police 100</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.callBtn, { backgroundColor: '#16a34a' }]} onPress={() => callEmergency('108', 'Ambulance')}>
                <Text style={styles.callBtnText}>📞 Ambulance 108</Text>
              </TouchableOpacity>
            </View>

            <FlatList
              data={places}
              keyExtractor={item => item.id}
              style={{ maxHeight: 300 }}
              ListEmptyComponent={<Text style={{ color: '#555', textAlign: 'center' }}>No places found nearby.</Text>}
              renderItem={({ item }) => (
                <View style={styles.placeCard}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.placeName}>
                      {item.type === 'police' ? '🔵' : '🟢'} {item.name}
                    </Text>
                    {item.phone && (
                      <Text style={styles.placePhone}>📞 {item.phone}</Text>
                    )}
                  </View>
                  {item.phone && (
                    <TouchableOpacity style={styles.callSmallBtn} onPress={() => callPlace(item.phone!)}>
                      <Text style={styles.callSmallText}>Call</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}
            />

            <TouchableOpacity onPress={() => setShowPlacesModal(false)}>
              <Text style={styles.cancelText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a1a', alignItems: 'center', justifyContent: 'center' },
  mapContainer: { flex: 1 },
  map: { flex: 1, width: '100%' },
  sub: { color: '#888', marginTop: 10, fontSize: 16 },
  error: { color: '#e63946', fontSize: 16, textAlign: 'center', padding: 20 },
  badge: { position: 'absolute', top: 50, alignSelf: 'center', backgroundColor: '#0a0a1a', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  badgeText: { color: '#fff', fontWeight: 'bold' },
  myLocationBtn: { position: 'absolute', top: 110, right: 16, backgroundColor: '#fff', width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', elevation: 4 },
  timerBox: { position: 'absolute', top: 110, alignSelf: 'center', backgroundColor: '#1a1a2e', borderRadius: 16, padding: 12, alignItems: 'center', flexDirection: 'row', gap: 12 },
  timerText: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  safeBtn: { backgroundColor: '#16a34a', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20 },
  safeBtnText: { color: '#fff', fontWeight: 'bold' },
  sosBox: { position: 'absolute', top: 110, alignSelf: 'center', backgroundColor: '#7f1d1d', borderRadius: 16, padding: 16, alignItems: 'center', width: '90%' },
  sosText: { color: '#fff', fontSize: 16, fontWeight: 'bold', marginBottom: 12 },
  callRow: { flexDirection: 'row', gap: 10, marginBottom: 8 },
  callBtn: { backgroundColor: '#1d4ed8', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  callBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  bottomBar: { position: 'absolute', bottom: 30, flexDirection: 'row', alignSelf: 'center', gap: 10 },
  smallBtn: { backgroundColor: '#1a1a2e', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 24, elevation: 4 },
  smallBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  shareBtn: { backgroundColor: '#e63946', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 24, elevation: 4 },
  shareBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 13 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#0f0f1f', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '85%' },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 16 },
  modalInput: { backgroundColor: '#1a1a2e', color: '#fff', borderRadius: 10, padding: 12, marginBottom: 10, fontSize: 14 },
  modalLabel: { color: '#aaa', fontSize: 13, marginBottom: 6 },
  searchBtn: { backgroundColor: '#1a1a2e', padding: 12, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  searchBtnText: { color: '#fff', fontWeight: 'bold' },
  resultItem: { backgroundColor: '#1a1a2e', padding: 12, borderRadius: 10, marginBottom: 6 },
  resultText: { color: '#fff', fontSize: 13 },
  destSelected: { color: '#16a34a', fontSize: 13, marginBottom: 12 },
  startBtn: { backgroundColor: '#e63946', padding: 14, borderRadius: 12, alignItems: 'center', marginBottom: 12 },
  startBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  cancelText: { color: '#888', textAlign: 'center', marginTop: 8, padding: 8 },
  placeCard: { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 12, marginBottom: 8, flexDirection: 'row', alignItems: 'center' },
  placeName: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  placePhone: { color: '#888', fontSize: 12, marginTop: 4 },
  callSmallBtn: { backgroundColor: '#1d4ed8', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  callSmallText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
});