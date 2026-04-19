import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyAgP5zfZdWrK7qdYIUOXklBRyf5mmqjb2c",
  authDomain: "sakhi-46fc5.firebaseapp.com",
  projectId: "sakhi-46fc5",
  storageBucket: "sakhi-46fc5.firebasestorage.app",
  messagingSenderId: "845725300818",
  appId: "1:845725300818:web:09beef3c0011c9d050078b"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export default app;