import AsyncStorage from '@react-native-async-storage/async-storage';

const GUARDIAN_KEY = 'offline_guardians';
const LOCATION_KEY = 'last_known_location';

export const saveGuardiansOffline = async (guardians: any[]) => {
  await AsyncStorage.setItem(GUARDIAN_KEY, JSON.stringify(guardians));
};

export const getGuardiansOffline = async () => {
  const data = await AsyncStorage.getItem(GUARDIAN_KEY);
  return data ? JSON.parse(data) : [];
};

export const saveLastLocation = async (location: { lat: number; lng: number }) => {
  await AsyncStorage.setItem(LOCATION_KEY, JSON.stringify(location));
};

export const getLastLocation = async () => {
  const data = await AsyncStorage.getItem(LOCATION_KEY);
  return data ? JSON.parse(data) : null;
};