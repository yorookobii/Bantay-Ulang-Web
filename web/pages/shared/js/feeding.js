import {db} from "./firebase.js";
import {
    collection,
    addDoc,
    serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function addFeedingRecord (){
 
 try{   await addDoc(collection(db, "feeding_records"), {
        userId: "Technician_User_ID", // Replace with actual user ID
        feedingDate: serverTimestamp(),
        feedType: "Starter Feed", // Example feed type
        feedQuantity: 1.5,
        feedingCycle: "Morning",
        feedingNotes: "Normal Feeding"
    });
    console.log("Feeding record added successfully.");
} catch (error) {
        console.error("Error adding feeding record: ", error);
    }   
}