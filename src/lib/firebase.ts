import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBbaZ6SuNSeOLpBDX_EkPSUz1o8ErNrjuk",
  authDomain: "supplier-match-ai.firebaseapp.com",
  projectId: "supplier-match-ai",
  storageBucket: "supplier-match-ai.firebasestorage.app",
  messagingSenderId: "17578068502",
  appId: "1:17578068502:web:98d8204d9f97925074c337",
};

export const firebaseApp = initializeApp(firebaseConfig);
export const auth = getAuth(firebaseApp);
export const googleAuthProvider = new GoogleAuthProvider();
export const db = getFirestore(firebaseApp);
