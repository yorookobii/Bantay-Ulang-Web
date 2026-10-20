// Single Firebase web config; the demo branch changes only these values.
export const firebaseConfig = {
    apiKey: "AIzaSyB5lE_zlqtv4R47V5xwNOAFEtis1fEmJWg",
    authDomain: "bantay-ulang-demo.firebaseapp.com",
    projectId: "bantay-ulang-demo",
    storageBucket: "bantay-ulang-demo.firebasestorage.app",
    messagingSenderId: "27416218351",
    appId: "1:27416218351:web:a5bc68e24702eb6707291a"
};

export const IS_DEMO = firebaseConfig.projectId === "bantay-ulang-demo";

// Demo deployments get a fixed bottom banner on every page that loads Firebase.
