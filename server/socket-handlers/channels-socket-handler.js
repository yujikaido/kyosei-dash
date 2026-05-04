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
 * Uses the sensor's PRTG-server credentials and asks for the right
 * aggregation level so we don't pull 100k+ raw points for a 7d view.
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

    // Pick aggregation: < 24h = raw scan, < 7d = 5min avg, else 60min avg.
    // Keeps response size reasonable and chart performant.
    let avg = 0;
    if (hours > 24 && hours <= 168) avg = 300;       // 5 min
    else if (hours > 168) avg = 3600;                // 1 hour

    const resp = await client.getHistory(monitor.prtg_sensor_id, startDate, endDate, avg);
    const rows = (resp && resp.histdata) || [];

    return rows.map((r) => {
        // PRTG returns datetime in its own local TZ as a string. We want UTC
        // ISO so the browser parses it correctly. PRTG also gives a numeric
        // datetime_raw on each row for easy parsing.
        let t;
        if (r.datetime_raw) {
            // PRTG datetime_raw is OLE Automation date — days since 1899-12-30.
            // Convert: ms = (oleDate - 25569) * 86400 * 1000.
            const oleDays = Number(r.datetime_raw);
            const ms = (oleDays - 25569) * 86400 * 1000;
            t = new Date(ms).toISOString();
        } else if (r.datetime) {
            // Fallback to text parse
            const parsed = Date.parse(String(r.datetime).replace(/[‐–]/g, "-"));
            t = isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
        } else {
            t = new Date().toISOString();
        }

        // Strip PRTG's metadata keys ("datetime", "datetime_raw", "coverage_raw" etc.);
        // anything left that's numeric is a channel value.
        const channels = {};
        for (const [ k, v ] of Object.entries(r)) {
            if (k.startsWith("datetime") || k === "coverage" || k === "coverage_raw") continue;
            if (k.endsWith("_raw")) {
                const baseKey = k.slice(0, -4);
                const num = Number(v);
                if (!isNaN(num)) channels[baseKey] = num;
            }
        }
        return { t, channels };
    }).filter((p) => Object.keys(p.channels).length > 0);
}

module.exports.channelsSocketHandler = (socket) => {
    socket.on("getChannelHistory", async (monitorID, hours, callback) => {
        try {
            checkLogin(socket);
            const h = Math.max(1, Math.min(Number(hours) || 24, 720));

            // First, see if this is a PRTG monitor we can query directly
            const monitor = await R.findOne("monitor", "id = ?", [ monitorID ]);
            if (monitor && monitor.type === "prtg" && monitor.prtg_server_id && monitor.prtg_sensor_id) {
                try {
                    const points = await fetchPrtgHistory(monitor, h);
                    if (points && points.length) {
                        callback({ ok: true, points, source: "prtg" });
                        return;
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
