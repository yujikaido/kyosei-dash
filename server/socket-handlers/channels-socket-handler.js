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

    const resp = await client.getHistory(monitor.prtg_sensor_id, startDate, endDate, avg);
    const rows = (resp && resp.histdata) || [];
    if (!rows.length) return [];

    // Log the first raw row once so we can see PRTG's actual response shape
    // if the parser misses something. Logged at debug level only.
    log.debug("channels", `PRTG history sample row (sensor ${monitor.prtg_sensor_id}): ${JSON.stringify(rows[0])}`);

    const META_KEYS = new Set(["datetime", "datetime_raw", "coverage", "coverage_raw"]);
    const RAW_SUFFIX_RE = /^(.+?)(?:\(RAW\)|_raw)$/i;

    const points = rows.map((r) => {
        // Time: prefer datetime_raw (OLE Automation date — days since 1899-12-30),
        // fall back to text parse of `datetime`.
        let t;
        if (r.datetime_raw !== undefined && r.datetime_raw !== null && !isNaN(Number(r.datetime_raw))) {
            const oleDays = Number(r.datetime_raw);
            const ms = (oleDays - 25569) * 86400 * 1000;
            t = new Date(ms).toISOString();
        } else if (r.datetime) {
            const parsed = Date.parse(String(r.datetime));
            t = isNaN(parsed) ? null : new Date(parsed).toISOString();
        } else {
            t = null;
        }
        if (!t) return null;

        // Build channels:
        //   Pass 1: pick up `<key>(RAW)` / `<key>_raw` numeric companions.
        //   Pass 2: for any plain key not yet captured whose value is numeric, take it.
        const channels = {};
        for (const [ k, v ] of Object.entries(r)) {
            if (META_KEYS.has(k)) continue;
            const m = RAW_SUFFIX_RE.exec(k);
            if (m) {
                const num = Number(v);
                if (!isNaN(num) && isFinite(num)) channels[m[1].trim()] = num;
            }
        }
        for (const [ k, v ] of Object.entries(r)) {
            if (META_KEYS.has(k)) continue;
            if (RAW_SUFFIX_RE.test(k)) continue;
            if (channels[k] !== undefined) continue;
            const num = Number(v);
            if (!isNaN(num) && isFinite(num) && typeof v !== "boolean") {
                channels[k] = num;
            }
        }
        return { t, channels };
    }).filter((p) => p && Object.keys(p.channels).length > 0);

    return points;
}

module.exports.channelsSocketHandler = (socket) => {
    socket.on("getChannelHistory", async (monitorID, hours, callback) => {
        try {
            checkLogin(socket);
            const h = Math.max(1, Math.min(Number(hours) || 24, 720));

            // First, see if this is a PRTG monitor we can query directly,
            // and if the response actually yields multiple channels (single-
            // channel/"value" responses indicate the parser missed the real
            // channel keys — fall back to local heartbeat data instead).
            const monitor = await R.findOne("monitor", "id = ?", [ monitorID ]);
            if (monitor && monitor.type === "prtg" && monitor.prtg_server_id && monitor.prtg_sensor_id) {
                try {
                    const points = await fetchPrtgHistory(monitor, h);
                    if (points && points.length) {
                        // Sanity check: PRTG traffic sensors have multiple
                        // named channels. If we only got 1 generic "value"
                        // key, the response shape is one we don't handle —
                        // fall through to local instead of showing a broken chart.
                        const sampleKeys = Object.keys(points[0].channels);
                        const looksGeneric = sampleKeys.length === 1 && /^value$/i.test(sampleKeys[0]);
                        if (!looksGeneric) {
                            callback({ ok: true, points, source: "prtg" });
                            return;
                        }
                        log.warn("channels", `PRTG response had only generic 'value' key for monitor ${monitorID} — falling back to local heartbeat data`);
                    }
                } catch (e) {
                    log.warn("channels", `PRTG history fetch failed for monitor ${monitorID}, falling back to local: ${e.message}`);
                }
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
