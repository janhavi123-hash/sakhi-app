import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../config/firebase';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async () => {
    if (!email || !password) return Alert.alert('Error', 'Please fill all fields');
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      router.replace('/(tabs)');
    } catch (e: any) {
        const errorCode = e?.code;
        let message = 'Login failed. Please try again.';
        if (errorCode === 'auth/user-not-found' || errorCode === 'auth/invalid-credential') {
            message = 'No account found. Please sign up first.';
        } else if (errorCode === 'auth/wrong-password') {
            message = 'Incorrect password. Please try again.';
        } else if (errorCode === 'auth/invalid-email') {
            message = 'Please enter a valid email.';
        }
        Alert.alert('Error', message);
    }
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome Back 👋</Text>
      <Text style={styles.subtitle}>Login to Sakhi</Text>

      <TextInput
        placeholder="Email address"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        style={styles.input}
      />
      <TextInput
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={styles.input}
      />

      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'Logging in...' : 'Login'}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.replace('/signup')}>
        <Text style={styles.link}>No account? Sign up here</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: '#fff' },
  title: { fontSize: 32, fontWeight: 'bold', color: '#e91e8c', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 32 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 14, marginBottom: 16, fontSize: 16 },
  button: { backgroundColor: '#e91e8c', padding: 16, borderRadius: 12, alignItems: 'center', marginBottom: 8 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  link: { textAlign: 'center', marginTop: 16, color: '#e91e8c', fontSize: 15 },
});