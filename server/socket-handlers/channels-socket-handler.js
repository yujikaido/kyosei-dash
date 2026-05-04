const { checkLogin } = require("../util-server");
const { R } = require("redbean-node");
const { createPrtgClient } = require("../prtg-client");
const { log } = require("../../src/util");

/**
 * Kyosei Dash — fetch channel history for a monitor.
 *
 * For PRTG-type monitors, query PRTG's historicdata.json directly so the
 * chart can show months/years of data, not just whatever Kuma's heartbeat
 * trim has retained locally. Falls back to local heartbeat rows for any
 * non-PRTG monitor or if the PRTG fetch fails.
 *
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
/**
 * Kyosei Dash — fetch historical channel data straight from PRTG.
 *
 * PRTG's /api/historicdata.json response varies across versions/configs:
 *   v1 (newer): { histdata: [{ datetime, "Traffic In": "...", "Traffic In(RAW)": 150000, ... }] }
 *   v2 (older): { histdata: [{ datetime, "Traffic In": "...", "Traffic In_raw": 150000, ... }] }
 *   v3 (some):  { histdata: [{ datetime, "Traffic In": 150000, ... }] }   -- already numeric
 * Plus metadata keys (datetime, datetime_raw, coverage, coverage_raw).
 *
 * Strategy: any key whose value is a finite number (or whose `<key>(RAW)` /
 * `<key>_raw` companion is a finite number) becomes a channel. Strip the
 * known metadata. If no channels survive, return [] so the caller falls
 * back to local heartbeat data.
 *
 * @param {object} monitor monitor row with prtg_server_id + prtg_sensor_id
 * @param {number} hours window in hours
 * @returns {Promise<Array>} array of { t, channels } points
 */
async function fetchPrtgHistory(monitor, hours) {
    const srv = await R.findOne("prtg_server", "id = ?", [ monitor.prtg_server_id ]);
    if (!srv) throw new Error("PRTG server not found");

    const client = createPrtgClient({
        url: srv.url,
        username: srv.username,
        passhash: srv.passhash,
        apiToken: srv.api_token,
        useApiToken: !!srv.use_api_token,
        ignoreSsl: !!srv.ignore_ssl,
    });

    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - hours * 60 * 60 * 1000);

    // Pick aggregation: < 24h raw, < 7d 5-min avg, else 1-hour avg.
    let avg = 0;
    if (hours > 24 && hours <= 168) avg = 300;
    else if (hours > 168) avg = 3600;

    log.info("channels", `[KYOSEI-PRTG-FETCH] sensor=${monitor.prtg_sensor_id} hours=${hours} avg=${avg}s start=${startDate.toISOString()} end=${endDate.toISOString()}`);

    // Use CSV endpoint — historicdata.json only returns the primary channel.
    // CSV returns one column per channel, which is what we need for traffic
    // sensors with Traffic In / Out / Total / Downtime.
    const csv = await client.getHistoryCsv(monitor.prtg_sensor_id, startDate, endDate, avg);
    const points = parsePrtgHistoryCsv(csv);
    log.info("channels", `[KYOSEI-PRTG-FETCH] sensor=${monitor.prtg_sensor_id} parsed ${points.length} CSV points`);
    if (points.length > 0) {
        log.info("channels", `[KYOSEI-PRTG-FETCH] sample channels: ${Object.keys(points[0].channels).join(", ")}`);
    }
    return points;
}

/**
 * Parse PRTG's /api/historicdata.csv response into points.
 *
 * Sample header (excerpt; first row may be 'sep=,'):
 *   "Date Time","Traffic In(SPEED) (kbit/s)","Traffic In(SPEED)(RAW)","Traffic Out(SPEED) (kbit/s)","Traffic Out(SPEED)(RAW)","Total - Avg (kbit/s)","Total - Avg(RAW)","Downtime (%)","Downtime(RAW)","Coverage (%)","Coverage(RAW)"
 *
 * For each channel PRTG emits two columns: a display string ("5,380 kbit/s")
 * and a raw numeric value. We prefer the RAW column. Channel name = display
 * column header without the trailing unit/aggregation. Coverage is metadata.
 *
 * @param {string} csv raw CSV text
 * @returns {Array<{t: string, channels: object}>} parsed points
 */
function parsePrtgHistoryCsv(csv) {
    const lines = csv.split(/\r?\n/).filter((ln) => ln.length > 0);
    if (!lines.length) return [];
    // Skip optional Excel separator hint
    if (/^sep=/i.test(lines[0])) lines.shift();
    if (lines.length < 2) return [];

    const header = parseCsvRow(lines[0]);
    // Identify the date column (display) and any date-related raw companion
    // so we skip them entirely. PRTG includes "Date Time" + "Date Time(RAW)".
    const isDateColumn = (h) => /^date\s*time/i.test(h) || /^date$/i.test(h) || /^time$/i.test(h);
    // Skip these as well — PRTG metadata, not real channels:
    const isMetaColumn = (h) => /coverage/i.test(h);
    // Volume channels are cumulative byte counters and ruin a rate chart's
    // y-axis (huge values that swamp the actual kbit/s lines). Drop them.
    const isVolumeColumn = (h) => /\(\s*Volume\s*\)/i.test(h);

    const channelCols = []; // { idx, name }
    const skipSet = new Set();
    // Pre-mark indices we never want to touch
    for (let i = 0; i < header.length; i++) {
        const h = header[i];
        if (isDateColumn(h) || isMetaColumn(h) || isVolumeColumn(h)) skipSet.add(i);
    }
    // Pass 1: prefer "(RAW)" / "_raw" numeric companions
    for (let i = 0; i < header.length; i++) {
        if (skipSet.has(i)) continue;
        const h = header[i];
        const rawMatch = /^(.+?)\s*(?:\(RAW\)|_raw)\s*$/i.exec(h);
        if (rawMatch) {
            let name = rawMatch[1]
                .replace(/\(SPEED\)/gi, "")
                .replace(/\s*-\s*(Avg|Sum|Min|Max)\b/gi, "")
                .trim();
            // Re-check filters against the friendly name in case the (RAW)
            // suffix hid them above
            if (isDateColumn(name) || isVolumeColumn(name)) continue;
            channelCols.push({ idx: i, name });
            skipSet.add(i);
        }
    }
    // Pass 2: any remaining display column that's numeric becomes a channel
    if (lines.length > 1) {
        const sample = parseCsvRow(lines[1]);
        for (let i = 0; i < header.length; i++) {
            if (skipSet.has(i)) continue;
            // Skip if a RAW companion for this name was already captured
            const baseName = header[i]
                .replace(/\([^)]*\)/g, "")
                .replace(/\s*-\s*(Avg|Sum|Min|Max)\b/gi, "")
                .trim();
            if (channelCols.some((c) => c.name === baseName)) continue;
            const num = Number(String(sample[i] ?? "").replace(/,/g, "").replace(/[a-zA-Z%/\s]+$/, ""));
            if (!isNaN(num) && isFinite(num)) {
                channelCols.push({ idx: i, name: baseName, fromDisplay: true });
            }
        }
    }
    if (channelCols.length === 0) return [];

    // dateIdx for the row loop below
    const dateIdx = header.findIndex(isDateColumn);

    const points = [];
    for (let r = 1; r < lines.length; r++) {
        const cells = parseCsvRow(lines[r]);
        if (!cells.length) continue;
        const dateStr = cells[dateIdx];
        if (!dateStr) continue;
        // PRTG CSV date is local-time text e.g. "5/3/2026 10:52:54 AM" or
        // "4/27/2026 10:50:00 AM - 10:55:00 AM" for aggregated rows.
        // Take the start of the range for aggregated rows.
        const cleanDate = String(dateStr).split(" - ")[0].trim();
        const ms = Date.parse(cleanDate);
        if (isNaN(ms)) continue;

        const channels = {};
        for (const col of channelCols) {
            const cell = cells[col.idx];
            if (cell === undefined || cell === null || cell === "") continue;
            // Strip thousands separators and trailing units before Number()
            const cleaned = String(cell).replace(/,/g, "").replace(/[a-zA-Z%/\s]+$/, "");
            const num = Number(cleaned);
            if (!isNaN(num) && isFinite(num)) channels[col.name] = num;
        }
        if (Object.keys(channels).length > 0) {
            points.push({ t: new Date(ms).toISOString(), channels });
        }
    }
    return points;
}

/**
 * Minimal CSV row parser — handles quoted fields with embedded commas
 * and "" escapes. Sufficient for PRTG's well-formed historicdata.csv.
 *
 * @param {string} line one CSV line
 * @returns {string[]} cells
 */
function parseCsvRow(line) {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') {
                if (line[i + 1] === '"') { cur += '"'; i++; }
                else inQuotes = false;
            } else cur += c;
        } else {
            if (c === '"') inQuotes = true;
            else if (c === ",") { out.push(cur); cur = ""; }
            else cur += c;
        }
    }
    out.push(cur);
    return out.map((s) => s.trim());
}

module.exports.channelsSocketHandler = (socket) => {
    socket.on("getChannelHistory", async (monitorID, hours, callback) => {
        try {
            checkLogin(socket);
            const h = Math.max(1, Math.min(Number(hours) || 24, 720));

            // First, see if this is a PRTG monitor we can query directly,
            // and if the response actually yields multiple channels.
            const monitor = await R.findOne("monitor", "id = ?", [ monitorID ]);
            if (monitor && monitor.type === "prtg" && monitor.prtg_server_id && monitor.prtg_sensor_id) {
                try {
                    const points = await fetchPrtgHistory(monitor, h);
                    log.info("channels", `[KYOSEI-PRTG-FETCH] monitor=${monitorID} parsed ${points.length} points`);
                    if (points && points.length) {
                        const sampleKeys = Object.keys(points[0].channels);
                        log.info("channels", `[KYOSEI-PRTG-FETCH] monitor=${monitorID} extracted channel keys: ${sampleKeys.join(", ")}`);
                        const looksGeneric = sampleKeys.length === 1 && /^value$/i.test(sampleKeys[0]);
                        if (!looksGeneric) {
                            callback({ ok: true, points, source: "prtg" });
                            return;
                        }
                        log.warn("channels", `[KYOSEI-PRTG-FETCH] monitor=${monitorID} PRTG response had only generic 'value' — falling back to local heartbeat`);
                    } else {
                        log.warn("channels", `[KYOSEI-PRTG-FETCH] monitor=${monitorID} parser yielded 0 points — falling back to local heartbeat`);
                    }
                } catch (e) {
                    log.warn("channels", `[KYOSEI-PRTG-FETCH] monitor=${monitorID} fetch threw: ${e.message} — falling back to local`);
                }
            } else if (monitor && monitor.type === "prtg") {
                log.warn("channels", `[KYOSEI-PRTG-FETCH] monitor=${monitorID} is PRTG type but missing prtg_server_id (${monitor.prtg_server_id}) or prtg_sensor_id (${monitor.prtg_sensor_id}) — using local heartbeat`);
            }

            // Fallback: local heartbeat table (works for non-PRTG types
            // and serves as a safety net if PRTG is unreachable)
            const rows = await R.getAll(
                `SELECT time, channels, ping FROM heartbeat
                 WHERE monitor_id = ? AND channels IS NOT NULL AND time >= datetime('now', ?)
                 ORDER BY time ASC LIMIT 20000`,
                [ monitorID, `-${h} hours` ]
            );
            // Kyosei Dash — heartbeat.time is stored as a UTC string like
            // "YYYY-MM-DD HH:mm:ss" (no zone marker). Plain new Date(str) on
            // the client misreads that as LOCAL time, shifting every label
            // by the user's timezone offset. Serialize to proper ISO UTC
            // here so the browser parses it correctly.
            const points = rows.map((r) => {
                let iso = r.time;
                if (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(iso)) {
                    iso = iso.replace(" ", "T");
                    if (!/[zZ]|[+\-]\d{2}:?\d{2}$/.test(iso)) {
                        iso += "Z";
                    }
                }
                return {
                    t: iso,
                    ping: r.ping,
                    channels: r.channels ? JSON.parse(r.channels) : {},
                };
            });
            callback({ ok: true, points, source: "local" });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });

    socket.on("getNetworkOverview", async (callback) => {
        try {
            checkLogin(socket);
            // Latest heartbeat per PRTG monitor
            const monitors = await R.getAll(
                `SELECT m.id, m.name, m.prtg_device
                 FROM monitor m
                 WHERE m.type = 'prtg' AND m.active = 1`
            );
            const items = [];
            for (const m of monitors) {
                const hb = await R.getRow(
                    `SELECT time, status, ping, channels FROM heartbeat
                     WHERE monitor_id = ? AND channels IS NOT NULL
                     ORDER BY time DESC LIMIT 1`,
                    [ m.id ]
                );
                if (hb) {
                    let iso = hb.time;
                    if (typeof iso === "string" && /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(iso)) {
                        iso = iso.replace(" ", "T");
                        if (!/[zZ]|[+\-]\d{2}:?\d{2}$/.test(iso)) {
                            iso += "Z";
                        }
                    }
                    items.push({
                        id: m.id,
                        name: m.name,
                        device: m.prtg_device,
                        time: iso,
                        status: hb.status,
                        ping: hb.ping,
                        channels: hb.channels ? JSON.parse(hb.channels) : {},
                    });
                }
            }
            callback({ ok: true, items });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });
};
