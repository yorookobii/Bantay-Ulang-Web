// Flags physically impossible sensor values (e.g. the -1 waterTemp) as "suspect", separate from threshold "out of range".

// Inclusive physical bounds; null means unbounded on that side.
// PROVISIONAL: salinity/turbidity/tds maxima are pending the sensor datasheets (ask the ESP32 group for the sensor models).
export const PLAUSIBLE_BOUNDS = {
    ph:              { min: 0, max: 14 },
    waterTemp:       { min: 0, max: 50 },
    dissolvedOxygen: { min: 0, max: 20 },
    salinity:        { min: 0, max: 50 },
    turbidity:       { min: 0, max: 1000 },
    tds:             { min: 0, max: 5000 }
};

// True only for a finite number outside its field's bounds; missing values are "no data", not suspect.
export function isSuspect(field, value) {
    const bounds = PLAUSIBLE_BOUNDS[field];
    if (!bounds || typeof value !== "number" || !Number.isFinite(value)) return false;
    return (bounds.min !== null && value < bounds.min) || (bounds.max !== null && value > bounds.max);
}

// Returns the reading with suspect values nulled, plus the list of suspect fields.
export function sanitizeReading(reading) {
    const clean = { ...reading };
    const suspect = [];
    for (const field of Object.keys(PLAUSIBLE_BOUNDS)) {
        if (isSuspect(field, reading?.[field])) {
            clean[field] = null;
            suspect.push(field);
        }
    }
    return { reading: clean, suspect };
}
