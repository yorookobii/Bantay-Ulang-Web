// Single Firebase web config; the demo branch changes only these values.
export const firebaseConfig = {
    apiKey: "AIzaSyDK4Bw3fQpJGlt5kqDJvz8w-xQdZZLQO2M",
    authDomain: "bantay-ulang.firebaseapp.com",
    projectId: "bantay-ulang",
    storageBucket: "bantay-ulang.firebasestorage.app",
    messagingSenderId: "827033380382",
    appId: "1:827033380382:web:fa26f915847d837f5e300f",
    measurementId: "G-1DVHW69G6W"
};

export const IS_DEMO = firebaseConfig.projectId === "bantay-ulang-demo";

// Demo deployments get a fixed bottom banner on every page that loads Firebase.
if (IS_DEMO) {
    const banner = document.createElement("div");
    banner.setAttribute("role", "status");
    banner.textContent = "DEMO — simulated data · Demo cycle (training data, cycle 1)";
    Object.assign(banner.style, {
        position: "fixed", left: "50%", bottom: "12px", transform: "translateX(-50%)", zIndex: "10000",
        maxWidth: "calc(100vw - 32px)", padding: "6px 14px", borderRadius: "999px", pointerEvents: "none",
        background: "#b45309", color: "#fff", font: "600 12px/1.4 system-ui, sans-serif", textAlign: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,.25)"
    });
    document.body.appendChild(banner);
}
