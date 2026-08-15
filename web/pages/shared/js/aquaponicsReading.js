import { db } from "./firebase.js";
import { doc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/*
 * aquaponicsReading.js — shared read path for the live Aquaponics/Ulang
 * document (a SINGLE doc, ESP32-updated ~every 15 seconds — not a
 * collection). Centralizes the statistics.*.average nested-path extraction
 * so sensorReadings.js, yieldPrediction.js, and analyticsRecommendations.js
 * can't silently drift apart from each other.
 *
 * The returned field names intentionally match the old flat sensor_readings
 * schema (phLevel, waterTemp, dissolvedOxygen, salinity, turbidity,
 * waterLevel) so downstream consumers not yet migrated to Aquaponics
 * (alertsEngine.js, dashboard.js, thresholds.js's getRanges()) keep working
 * unchanged. `tds` is new — there was no legacy equivalent.
 *
 * Example Aquaponics/Ulang document:
 * {
 *   statistics: {
 *     phValue:            { average: 7.2 },
 *     waterTemperatureC:  { average: 24.5 },
 *     oxygenLevelMgL:     { average: 6.8 },
 *     tdsPpm:             { average: 3852 },
 *     salinityPpt:        { average: 15 },
 *     turbidityNTU:       { average: 116 },
 *     WaterLevel:         { latest: true }   // boolean: safe/unsafe, not a depth
 *   },
 *   measuredAt: <timestamp>
 * }
 */

export const AQUAPONICS_REF = doc(db, "Aquaponics", "Ulang");

/**
 * normalizeAquaponicsReading(raw)
 *
 * raw = the Aquaponics/Ulang document's data() (or undefined/null if the
 * doc doesn't exist yet). Never throws on a missing `statistics` object or
 * any missing sub-field — everything falls back to null.
 *
 * waterLevel is true | false | null. The sensor reports a binary
 * safe/unsafe state, not a continuous depth reading — see
 * formatWaterLevelText() for the matching display text.
 */
export function normalizeAquaponicsReading(raw) {
    const stats = raw?.statistics ?? {};
    return {
        phLevel:         stats.phValue?.average ?? null,
        waterTemp:       stats.waterTemperatureC?.average ?? null,
        dissolvedOxygen: stats.oxygenLevelMgL?.average ?? null,
        tds:             stats.tdsPpm?.average ?? null,
        salinity:        stats.salinityPpt?.average ?? null,
        turbidity:       stats.turbidityNTU?.average ?? null,
        waterLevel:      stats.WaterLevel?.latest ?? null,
        measuredAt:      raw?.measuredAt ?? null
    };
}

/**
 * formatWaterLevelText(waterLevel)
 *
 * waterLevel: true | false | null (see normalizeAquaponicsReading).
 * Centralizes the boolean → display-text mapping so every card/UI spot
 * agrees on the same wording.
 */
export function formatWaterLevelText(waterLevel) {
    if (waterLevel == null) return "--";
    return waterLevel ? "Safe Level" : "Unsafe Level";
}
