const { checkLogin } = require("../util-server");
const { R } = require("redbean-node");
const { createPrtgClient } = require("../prtg-client");
const { classifyPrtgSensor } = require("../prtg-capability-map");
const { UptimeKumaServer } = require("../uptime-kuma-server");

/**
 * Kyosei Dash — capability-aware PRTG import socket handlers.
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.prtgImportSocketHandler = (socket) => {
    socket.on("prtgImportPreview", async (serverId, callback) => {
        try {
            checkLogin(socket);
            const row = await R.findOne("prtg_server", "id = ?", [serverId]);
            if (!row) throw new Error("PRTG server not found");

            const client = createPrtgClient({
                url: row.url,
                username: row.username,
                passhash: row.passhash,
                apiToken: row.api_token,
                useApiToken: !!row.use_api_token,
                ignoreSsl: !!row.ignore_ssl,
            });

            const [ sensorsResp, devicesResp ] = await Promise.all([
                client.getSensors(),
                client.getDevices(),
            ]);
            const deviceMap = {};
            for (const d of (devicesResp && devicesResp.devices) || []) {
                deviceMap[String(d.device)] = d.host || d.device;
            }

            // Existing imports — key by prtg_sensor_id
            const existing = await R.getAll(
                "SELECT id, prtg_sensor_id FROM monitor WHERE type = 'prtg' AND prtg_server_id = ?",
                [serverId]
            );
            const existingSet = new Set(existing.map((r) => r.prtg_sensor_id));

            const sensors = ((sensorsResp && sensorsResp.sensors) || []).map((s) => {
                const classification = classifyPrtgSensor(s.sensor);
                return {
                    objid: s.objid,
                    sensor: s.sensor,
                    group: s.group,
                    device: s.device,
                    host: deviceMap[String(s.device)] || null,
                    status: s.status,
                    priority: s.priority,
                    interval: s.interval,
                    classification,
                    preTicked: classification === "prtg-only",
                    alreadyImported: existingSet.has(s.objid),
                };
            });

            callback({ ok: true, sensors });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });

    socket.on("prtgImportSensors", async (serverId, sensorIds, callback) => {
        try {
            checkLogin(socket);
            const row = await R.findOne("prtg_server", "id = ?", [serverId]);
            if (!row) throw new Error("PRTG server not found");

            const client = createPrtgClient({
                url: row.url,
                username: row.username,
                passhash: row.passhash,
                apiToken: row.api_token,
                useApiToken: !!row.use_api_token,
                ignoreSsl: !!row.ignore_ssl,
            });

            const sensorsResp = await client.getSensors();
            const allSensors = (sensorsResp && sensorsResp.sensors) || [];
            const byId = new Map(allSensors.map((s) => [s.objid, s]));
            const devicesResp = await client.getDevices();
            const deviceMap = {};   // device name -> host/IP
            for (const d of (devicesResp && devicesResp.devices) || []) {
                deviceMap[String(d.device)] = d.host || d.device;
            }

            const server = UptimeKumaServer.getInstance();
            let created = 0;
            let updated = 0;
            for (const id of sensorIds) {
                const s = byId.get(Number(id)) || byId.get(String(id));
                if (!s) continue;
                let bean = await R.findOne("monitor", "type = 'prtg' AND prtg_server_id = ? AND prtg_sensor_id = ?", [serverId, s.objid]);
                const isNew = !bean;
                if (isNew) {
                    bean = R.dispense("monitor");
                    bean.user_id = socket.userID;
                    bean.type = "prtg";
                    bean.active = true;
                    bean.weight = 2000;
                    bean.maxretries = 0;
                    bean.retryInterval = 60;
                    bean.timeout = 15;
                }
                bean.name = `${s.device || "PRTG"} — ${s.sensor}`;
                bean.prtg_server_id = serverId;
                bean.prtg_sensor_id = s.objid;
                // Store the friendly device NAME (e.g. "DC01-PDC"), not the
                // host/IP. The host is only useful for connection launchers,
                // which the user sets up manually now.
                bean.prtg_device = s.device || null;

                // PRTG intervals are like "60 s" — parse; floor at 60
                let iv = 60;
                if (s.interval) {
                    const m = String(s.interval).match(/(\d+)/);
                    if (m) iv = Math.max(60, Number(m[1]));
                }
                bean.interval = iv;

                await R.store(bean);

                // Kyosei Dash — actually schedule the monitor so it starts
                // polling immediately. Without this, newly-imported monitors
                // show "unknown" until the user pauses + resumes them.
                // (Mirrors server.js startMonitor() pattern.)
                if (server && server.io) {
                    try {
                        const fresh = await R.findOne("monitor", "id = ?", [bean.id]);
                        if (fresh && fresh.active) {
                            if (server.monitorList[fresh.id]) {
                                await server.monitorList[fresh.id].stop();
                            }
                            server.monitorList[fresh.id] = fresh;
                            await fresh.start(server.io);
                        }
                    } catch (e) {
                        // best-effort — broadcast still happens below
                    }
                }

                if (isNew) created++; else updated++;
            }

            // Broadcast the updated monitor list so the UI reflects the new rows
            try {
                await server.sendMonitorList(socket);
            } catch (e) {
                // best-effort
            }

            callback({ ok: true, created, updated });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });
};
