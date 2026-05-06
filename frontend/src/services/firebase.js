import { initializeApp } from "firebase/app";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyBuTjJesfHYVDYpx2JG6TRX4lT36oKhS0c",
  authDomain: "inferx-document-ai.firebaseapp.com",
  projectId: "inferx-document-ai",
  storageBucket: "inferx-document-ai.firebasestorage.app",
  messagingSenderId: "71448695357",
  appId: "1:71448695357:web:e8f50b0f5b31579ea89054"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Cloud Storage and get a reference to the service
export const storage = getStorage(app);
export const auth = getAuth(app);
