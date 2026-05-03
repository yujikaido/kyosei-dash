/**
 * Kyosei Dash — PRTG sensor capability classification.
 *
 * Maps a PRTG sensor (identified by its sensor type/name string) to:
 *   - "kuma-native" — Kuma already has a first-class monitor type. Pre-skip.
 *   - "prtg-only"   — no Kuma equivalent, PRTG only. Pre-tick.
 *
 * Based on plan §2 capability map.
 *
 * @param {string} sensorName e.g. "Ping", "SNMP Traffic", "CPU Load"
 * @returns {"kuma-native"|"prtg-only"} classification
 */
function classifyPrtgSensor(sensorName) {
    const n = String(sensorName || "").toLowerCase();

    // Kuma can do these natively
    const kumaPatterns = [
        /^ping$/,
        /^http/,
        /^https/,
        /^port$/,
        /^tcp/,
        /^dns$/,
        /^mysql/,
        /^postgres/,
        /^mongo/,
        /^redis/,
        /^mqtt/,
        /^rabbitmq/,
        /^grpc/,
        /^smtp/,
        /^push$/,
        /^docker/,
        /^steam/,
        /^gamedig/,
    ];
    for (const re of kumaPatterns) {
        if (re.test(n)) return "kuma-native";
    }

    // Everything else — assume PRTG-only until we say otherwise
    return "prtg-only";
}

module.exports = { classifyPrtgSensor };
