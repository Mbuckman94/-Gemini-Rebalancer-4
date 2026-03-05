import { initializeApp } from "firebase/app";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyCAQNKqPtXmHEdO7embWr1PtsqxWK8PmRA",
  authDomain: "rebalancer-69ebb.firebaseapp.com",
  projectId: "rebalancer-69ebb",
  storageBucket: "rebalancer-69ebb.appspot.com",
  messagingSenderId: "613406162475",
  appId: "1:613406162475:web:a7eda19896978b6d44f46e"
};

const app = initializeApp(firebaseConfig);
export const storage = getStorage(app);
export const auth = getAuth(app);
export const db = getFirestore(app);
