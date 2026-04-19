import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../config/firebase';

export default function SignupScreen() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSignup = async () => {
    if (!name || !email || !password) return Alert.alert('Error', 'Please fill all fields');
    if (password.length < 6) return Alert.alert('Error', 'Password must be at least 6 characters');
    setLoading(true);
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, 'users', result.user.uid), {
        name,
        email,
        createdAt: new Date().toISOString(),
      });
      router.replace('/(tabs)');
    } catch (e: any) {
        const errorCode = e?.code;
        let message = 'Signup failed. Please try again.';
        if (errorCode === 'auth/email-already-in-use') {
            message = 'An account already exists with this email. Please login.';
        } else if (errorCode === 'auth/invalid-email') {
            message = 'Please enter a valid email address.';
        }
        Alert.alert('Error', message);
    }
    setLoading(false);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Create Account 🌸</Text>
      <Text style={styles.subtitle}>Join Sakhi today</Text>

      <TextInput
        placeholder="Your name"
        value={name}
        onChangeText={setName}
        style={styles.input}
      />
      <TextInput
        placeholder="Email address"
        value={email}
        onChangeText={setEmail}
        keyboardType="email-address"
        autoCapitalize="none"
        style={styles.input}
      />
      <TextInput
        placeholder="Password (min 6 characters)"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        style={styles.input}
      />

      <TouchableOpacity style={styles.button} onPress={handleSignup} disabled={loading}>
        <Text style={styles.btnText}>{loading ? 'Creating account...' : 'Sign Up'}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={() => router.replace('/login')}>
        <Text style={styles.link}>Already have account? Login</Text>
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