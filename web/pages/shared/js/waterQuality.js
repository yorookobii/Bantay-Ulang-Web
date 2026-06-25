import { db } from "./firebase.js";
import {
    collection,
    addDoc,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function addWaterQualityRecord() {
    await addDoc(collection(db, "water_quality_records"), {
        sensorReadingId: "Sensor_Reading_ID", // Replace with actual sensor reading ID
        phStatus: "Normal",
        temperatureStatus: "Optimal",
        oxygenStatus: "Low",
        waterCondition: "Needs Aeration",
        recordedDate: serverTimestamp(),
        recordedBy: "Technician_User_ID" // Replace with actual user ID
    });
}
