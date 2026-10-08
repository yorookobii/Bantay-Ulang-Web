// Honest yield-model labels shared by the Analytics card and the report; pure, no Firestore.

// predict_yield.py rfMode only says where the weight came from; the water source is rfWaterSource, labelled separately.
const MODEL_MODE_LABELS = { real: "Measured weight", hybrid: "Assumed weight", test: "Test mode" };
const WATER_SOURCE_LABELS = { live: "live sensor water data", synthetic: "synthetic water data", mixed: "live and synthetic water data" };

export function modelModeLabel(mode, waterSource) {
    if (!mode) return "";
    const label = MODEL_MODE_LABELS[mode] || mode.charAt(0).toUpperCase() + mode.slice(1);
    const water = mode === "test" ? null : WATER_SOURCE_LABELS[waterSource];
    return water ? `${label}, ${water}` : label;
}

// Note for a prediction that isn't backed by live water data, or null when none is needed.
export function yieldWaterNote(mode, waterSource) {
    if (mode === "test" || waterSource === "live") return null;
    if (waterSource === "synthetic" || waterSource === "mixed") {
        return `This cycle's yield estimate used ${waterSource === "mixed" ? "partly " : ""}synthetic water data.`;
    }
    // Until predict_yield.py writes rfWaterSource, its only water data this cycle is the synthetic backfill.
    return waterSource == null ? "This cycle's yield estimate used synthetic water data (Jul 13 - Aug 9 backfill)." : null;
}
