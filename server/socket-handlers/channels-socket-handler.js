const { checkLogin } = require("../util-server");
const { R } = require("redbean-node");

/**
 * Kyosei Dash — fetch recent heartbeat channel history for a monitor.
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.channelsSocketHandler = (socket) => {
    socket.on("getChannelHistory", async (monitorID, hours, callback) => {
        try {
            checkLogin(socket);
            const h = Math.max(1, Math.min(Number(hours) || 24, 720));
            // 7 days at 60s intervals is ~10k rows. Bumping the cap so the 7d
            // view actually covers 7 days; we also down-sample on the client
            // if needed (chart.js handles ~20k points fine).
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
            callback({ ok: true, points });
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
