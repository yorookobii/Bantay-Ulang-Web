// "Basis" line for Analytics recommendation cards: where the safe range and the action come from.

// Key informant ranges: R. Regalado, BFAR Pampanga (interview, Dec 9 2025).
export const REGALADO_RANGES = {
    phLevel:         { min: 7.0,  max: 8.5 },
    waterTemp:       { min: 28,   max: 31 },
    dissolvedOxygen: { min: 5,    max: 8 },
    salinity:        { min: 0,    max: 15 },
    turbidity:       { min: null, max: 100 },
    waterLevel:      { min: 0.8,  max: 2.2 }
};

const REGALADO_TEXT = "Safe range from R. Regalado, BFAR Pampanga (interview, Dec 2025).";
const DO_TEXT = "Minimum DO from R. Regalado, BFAR Pampanga (interview, Dec 2025).";
const WATER_LEVEL_TEXT = "Water level comes from a float switch that reports only safe or unsafe, so no measured depth is checked. "
    + "Reference depth 0.8–2.2 m from R. Regalado, BFAR Pampanga (interview, Dec 2025).";
const ACTION_TEXT = "Recommended action written by the Bantay Ulang team, pending expert review.";

// Params that cannot go below zero, so an unset lower bound equals 0.
const ZERO_FLOOR = new Set(["salinity", "turbidity"]);
const low = (param, v) => v ?? (ZERO_FLOOR.has(param) ? 0 : null);

// True when the active range equals Regalado's; DO is compared on its minimum only (no o2_max setting).
function matchesRegalado(param, activeRange) {
    const ref = REGALADO_RANGES[param];
    if (!ref || !activeRange) return false;
    if (low(param, ref.min) !== low(param, activeRange.min)) return false;
    return param === "dissolvedOxygen" || ref.max === (activeRange.max ?? null);
}

/** Range sentence plus the action sentence; source is "saved" or "default" (thresholds.js getRangeSource). */
export function basisFor(param, activeRange, source) {
    let range;
    if (param === "waterLevel") range = WATER_LEVEL_TEXT;
    else if (matchesRegalado(param, activeRange)) range = param === "dissolvedOxygen" ? DO_TEXT : REGALADO_TEXT;
    else range = source === "saved" ? "Safe range set by the administrator." : "System default range.";
    return `${range} ${ACTION_TEXT}`;
}
