import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js';

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

async function ensureUser(user) {
  if (!user) return;
  const userRef = doc(db, 'users', user.uid);
  const snapshot = await getDoc(userRef);
  if (!snapshot.exists()) {
    await setDoc(userRef, {
      email: user.email ?? null,
      createdAt: serverTimestamp(),
    });
    return;
  }

  if ((snapshot.data().email ?? null) !== (user.email ?? null)) {
    await updateDoc(userRef, { email: user.email ?? null });
  }
}

async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleAuthProvider);
  try {
    await ensureUser(result.user);
  } catch (error) {
    console.warn('Firestore user sync failed', error);
  }
  return result;
}

async function startSearch({ query: searchQuery, criteria }) {
  const user = auth.currentUser;
  if (!user) return null;

  const searchRef = await addDoc(collection(db, 'searches'), {
    userId: user.uid,
    query: searchQuery,
    criteria,
    results: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return searchRef.id;
}

async function completeSearch(searchId, results) {
  const user = auth.currentUser;
  if (!user || !searchId) return;

  const searchRef = doc(db, 'searches', searchId);
  const snapshot = await getDoc(searchRef);
  if (!snapshot.exists() || snapshot.data().userId !== user.uid) return;

  await updateDoc(searchRef, {
    results,
    updatedAt: serverTimestamp(),
  });
}

async function listSearches() {
  const user = auth.currentUser;
  if (!user) return [];

  const searchesQuery = query(collection(db, 'searches'), where('userId', '==', user.uid));
  const snapshot = await getDocs(searchesQuery);
  return snapshot.docs.map((searchDoc) => ({ id: searchDoc.id, ...searchDoc.data() }));
}

onAuthStateChanged(auth, (user) => {
  if (!user) return;
  void ensureUser(user).catch((error) => {
    console.warn('Firestore restored-session sync failed', error);
  });
});

window.supplierMatchFirebase = {
  app,
  auth,
  db,
  signInWithGoogle,
  subscribeToAuth: (callback) => onAuthStateChanged(auth, callback),
  signOutUser: () => signOut(auth),
  ensureCurrentUser: () => ensureUser(auth.currentUser),
  startSearch,
  completeSearch,
  listSearches,
};

window.dispatchEvent(new Event('supplier-match-firebase-ready'));
