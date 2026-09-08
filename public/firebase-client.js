import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBbaZ6SuNSeOLpBDX_EkPSUz1o8ErNrjuk',
  authDomain: 'supplier-match-ai.firebaseapp.com',
  projectId: 'supplier-match-ai',
  storageBucket: 'supplier-match-ai.firebasestorage.app',
  messagingSenderId: '17578068502',
  appId: '1:17578068502:web:98d8204d9f97925074c337',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleAuthProvider = new GoogleAuthProvider();
const db = getFirestore(app);

window.supplierMatchFirebase = {
  app,
  auth,
  db,
  signInWithGoogle: () => signInWithPopup(auth, googleAuthProvider),
  subscribeToAuth: (callback) => onAuthStateChanged(auth, callback),
  signOutUser: () => signOut(auth),
};

window.dispatchEvent(new Event('supplier-match-firebase-ready'));
