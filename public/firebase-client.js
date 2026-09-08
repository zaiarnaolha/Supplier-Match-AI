import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js';
import { getAuth, GoogleAuthProvider } from 'https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js';
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

window.supplierMatchFirebase = {
  app,
  auth: getAuth(app),
  googleAuthProvider: new GoogleAuthProvider(),
  db: getFirestore(app),
};
