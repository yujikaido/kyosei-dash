const { checkLogin } = require("../util-server");
const { R } = require("redbean-node");
const { createPrtgClient } = require("../prtg-client");

/**
 * Kyosei Dash — PRTG server registry socket handlers.
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.prtgServerSocketHandler = (socket) => {
    socket.on("getPrtgServerList", async (callback) => {
        try {
            checkLogin(socket);
            const rows = await R.findAll("prtg_server");
            const list = rows.map((r) => ({
                id: r.id,
                name: r.name,
                url: r.url,
                username: r.username,
                useApiToken: !!r.use_api_token,
                ignoreSsl: !!r.ignore_ssl,
                hasPasshash: !!r.passhash,
                hasApiToken: !!r.api_token,
                mapUrl: r.map_url || "",
            }));
            callback({ ok: true, list });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });

    socket.on("savePrtgServer", async (data, id, callback) => {
        try {
            checkLogin(socket);
            let bean;
            if (id) {
                bean = await R.findOne("prtg_server", "id = ?", [id]);
                if (!bean) {
                    throw new Error("PRTG server not found");
                }
            } else {
                bean = R.dispense("prtg_server");
            }
            bean.name = data.name;
            bean.url = data.url;
            bean.username = data.username || null;
            if (data.passhash) {
                bean.passhash = data.passhash;
            }
            if (data.apiToken) {
                bean.api_token = data.apiToken;
            }
            bean.use_api_token = !!data.useApiToken;
            bean.ignore_ssl = !!data.ignoreSsl;
            bean.map_url = data.mapUrl || null;
            const newId = await R.store(bean);
            callback({ ok: true, id: newId });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });

    socket.on("deletePrtgServer", async (id, callback) => {
        try {
            checkLogin(socket);
            const bean = await R.findOne("prtg_server", "id = ?", [id]);
            if (bean) {
                await R.trash(bean);
            }
            callback({ ok: true });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });

    socket.on("testPrtgServer", async (data, callback) => {
        try {
            checkLogin(socket);
            let config = { ...data };
            if (data.id && !data.passhash && !data.apiToken) {
                const row = await R.findOne("prtg_server", "id = ?", [data.id]);
                if (row) {
                    config.username = config.username || row.username;
                    config.passhash = config.passhash || row.passhash;
                    config.apiToken = config.apiToken || row.api_token;
                }
            }
            const client = createPrtgClient({
                url: config.url,
                username: config.username,
                passhash: config.passhash,
                apiToken: config.apiToken,
                useApiToken: !!config.useApiToken,
                ignoreSsl: !!config.ignoreSsl,
            });
            // Use the same endpoint the importer relies on (table.json) so the
            // test is a true positive of "things will actually work". Some
            // PRTG installs return 404 on /api/getstatus.json depending on
            // version/config, even though /api/table.json works.
            const probe = await client.prtgGet("/api/table.json", {
                content: "groups",
                output: "json",
                columns: "objid",
                count: 1,
            });
            // Best-effort version pull, but don't fail the test if it 404s
            let version = null;
            try {
                const status = await client.getStatus();
                version = status && status.Version;
            } catch (e) { /* PRTG version not exposed on this install */ }
            const ok = !!(probe && (probe.groups || probe.treesize !== undefined));
            if (!ok) throw new Error("PRTG responded but the result was unexpected");
            callback({ ok: true, version });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });

    // Kyosei Dash — bulk operations on monitors
    socket.on("kyoseiBulkMoveToGroup", async (monitorIds, groupId, callback) => {
        try {
            checkLogin(socket);
            const ids = (monitorIds || []).map((x) => Number(x)).filter(Boolean);
            const gid = Number(groupId);
            if (!ids.length || !gid) {
                throw new Error("Missing monitorIds or groupId");
            }
            // Verify the target is actually a group
            const grp = await R.findOne("monitor", "id = ? AND type = 'group'", [gid]);
            if (!grp) throw new Error("Target group not found");
            const placeholders = ids.map(() => "?").join(",");
            await R.exec(
                `UPDATE monitor SET parent = ? WHERE id IN (${placeholders}) AND id != ?`,
                [gid, ...ids, gid]
            );
            const server = require("../uptime-kuma-server").UptimeKumaServer.getInstance();
            try { await server.sendMonitorList(socket); } catch (e) { /* best effort */ }
            callback({ ok: true, count: ids.length });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });

    // Kyosei Dash — group selected sensors by their prtg_device field,
    // auto-creating intermediate "group" monitors under the optional parent.
    // Also strips the "DEVICE — " prefix from sensor names so the tree reads
    // cleanly: ParentGroup ▸ DeviceGroup ▸ Sensor.
    socket.on("kyoseiBulkGroupByDevice", async (monitorIds, parentGroupId, callback) => {
        try {
            checkLogin(socket);
            const ids = (monitorIds || []).map((x) => Number(x)).filter(Boolean);
            if (!ids.length) throw new Error("No monitors selected");

            const parentId = parentGroupId ? Number(parentGroupId) : null;
            if (parentId) {
                const grp = await R.findOne("monitor", "id = ? AND type = 'group'", [parentId]);
                if (!grp) throw new Error("Parent group not found");
            }

            const placeholders = ids.map(() => "?").join(",");
            const monitors = await R.getAll(
                `SELECT id, name, prtg_device, prtg_server_id FROM monitor WHERE id IN (${placeholders})`,
                ids
            );

            // Bucket selected monitors by their device label.
            // Preferred: the prefix of the monitor name before " — " or " - "
            // (importer names sensors as "DEVICE — SENSOR"), since that's the
            // friendly PRTG device name. Falls back to prtg_device column.
            const byDevice = new Map();
            for (const m of monitors) {
                let dev = "";
                const match = String(m.name || "").match(/^(.+?)\s*[—–-]\s*.+$/);
                if (match) {
                    dev = match[1].trim();
                }
                if (!dev) {
                    dev = (m.prtg_device || "").trim();
                }
                if (!dev) continue;   // skip anything we can't classify
                if (!byDevice.has(dev)) byDevice.set(dev, []);
                byDevice.get(dev).push(m);
            }
            if (byDevice.size === 0) {
                throw new Error("Could not detect a device for any selected monitor (need a name like 'DEVICE — SENSOR' or a Device field set)");
            }

            let groupsCreated = 0;
            let monitorsMoved = 0;
            for (const [ device, list ] of byDevice.entries()) {
                // Find or create the device-level group under the chosen parent
                let group;
                if (parentId) {
                    group = await R.findOne(
                        "monitor",
                        "type = 'group' AND name = ? AND parent = ?",
                        [device, parentId]
                    );
                } else {
                    group = await R.findOne(
                        "monitor",
                        "type = 'group' AND name = ? AND parent IS NULL",
                        [device]
                    );
                }
                if (!group) {
                    group = R.dispense("monitor");
                    group.user_id = socket.userID;
                    group.type = "group";
                    group.name = device;
                    group.active = true;
                    group.weight = 1500;
                    group.maxretries = 0;
                    group.interval = 60;
                    group.retryInterval = 60;
                    group.timeout = 15;
                    group.parent = parentId;
                    group.prtg_device = device;
                    if (list[0] && list[0].prtg_server_id) {
                        group.prtg_server_id = list[0].prtg_server_id;
                    }
                    groupsCreated++;
                }
                const groupRowId = await R.store(group);

                // Reparent each selected monitor under the device group, and
                // strip the "DEVICE — " or "DEVICE - " prefix from its name
                const namePrefix = new RegExp(`^${device.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[—–-]\\s*`, "i");
                for (const m of list) {
                    const newName = m.name.replace(namePrefix, "").trim() || m.name;
                    await R.exec(
                        "UPDATE monitor SET parent = ?, name = ? WHERE id = ?",
                        [groupRowId, newName, m.id]
                    );
                    monitorsMoved++;
                }
            }

            const server = require("../uptime-kuma-server").UptimeKumaServer.getInstance();
            try { await server.sendMonitorList(socket); } catch (e) { /* best effort */ }
            callback({ ok: true, groupsCreated, monitorsMoved, devices: byDevice.size });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });

    /**
     * Kyosei Dash — bulk add a connection launcher to selected monitors.
     * The template can include {host} which is substituted per-monitor from
     * monitor.hostname (or URL hostname for HTTP monitors). Existing
     * connections on each monitor are kept; the new one is appended.
     */
    socket.on("kyoseiBulkAddConnection", async (monitorIds, template, callback) => {
        try {
            checkLogin(socket);
            const ids = (monitorIds || []).map((x) => Number(x)).filter(Boolean);
            if (!ids.length) throw new Error("No monitors selected");
            if (!template || !template.type) throw new Error("Connection template missing");

            const placeholders = ids.map(() => "?").join(",");
            const monitors = await R.getAll(
                `SELECT id, hostname, url, prtg_device, connections FROM monitor WHERE id IN (${placeholders})`,
                ids
            );

            let added = 0;
            let skipped = 0;
            for (const m of monitors) {
                // Resolve {host} in this priority:
                //   1. monitor.hostname (ping/port/snmp etc.)
                //   2. URL hostname (HTTP-type monitors)
                //   3. monitor.prtg_device — the universal "Device" field,
                //      which users typically set to the IP/hostname for any
                //      monitor type (PRTG sensors especially)
                let host = m.hostname || "";
                if (!host && m.url) {
                    try { host = new URL(m.url).hostname; } catch (e) { /* ignore */ }
                }
                if (!host && m.prtg_device) {
                    host = String(m.prtg_device).trim();
                }
                if (!host && /\{host\}/.test(JSON.stringify(template))) {
                    skipped++;
                    continue;
                }
                const subbed = JSON.parse(JSON.stringify(template));
                for (const k of Object.keys(subbed)) {
                    if (typeof subbed[k] === "string") {
                        subbed[k] = subbed[k].replace(/\{host\}/g, host);
                    }
                }
                let existing = [];
                try { existing = m.connections ? JSON.parse(m.connections) : []; } catch (e) { /* ignore */ }
                if (!Array.isArray(existing)) existing = [];
                existing.push(subbed);
                await R.exec("UPDATE monitor SET connections = ? WHERE id = ?", [
                    JSON.stringify(existing),
                    m.id,
                ]);
                added++;
            }

            const server = require("../uptime-kuma-server").UptimeKumaServer.getInstance();
            try { await server.sendMonitorList(socket); } catch (e) { /* best effort */ }
            callback({ ok: true, added, skipped });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });

    /**
     * Kyosei Dash — toggle a monitor's pinned-to-dashboard flag.
     * System-wide setting; everyone sees the same pinned monitors.
     */
    socket.on("kyoseiSetPinned", async (monitorId, pinned, callback) => {
        try {
            checkLogin(socket);
            const id = Number(monitorId);
            if (!id) throw new Error("Missing monitorId");
            await R.exec("UPDATE monitor SET pinned_to_dashboard = ? WHERE id = ?", [
                pinned ? 1 : 0,
                id,
            ]);
            const server = require("../uptime-kuma-server").UptimeKumaServer.getInstance();
            try { await server.sendMonitorList(socket); } catch (e) { /* best effort */ }
            callback({ ok: true });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });

    socket.on("kyoseiBulkSetDevice", async (monitorIds, device, callback) => {
        try {
            checkLogin(socket);
            const ids = (monitorIds || []).map((x) => Number(x)).filter(Boolean);
            if (!ids.length) throw new Error("No monitors selected");
            const dev = device && String(device).trim() ? String(device).trim() : null;
            const placeholders = ids.map(() => "?").join(",");
            await R.exec(
                `UPDATE monitor SET prtg_device = ? WHERE id IN (${placeholders})`,
                [dev, ...ids]
            );
            const server = require("../uptime-kuma-server").UptimeKumaServer.getInstance();
            try { await server.sendMonitorList(socket); } catch (e) { /* best effort */ }
            callback({ ok: true, count: ids.length });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });

    socket.on("prtgListSensors", async (serverId, callback) => {
        try {
            checkLogin(socket);
            const row = await R.findOne("prtg_server", "id = ?", [serverId]);
            if (!row) {
                throw new Error("PRTG server not found");
            }
            const client = createPrtgClient({
                url: row.url,
                username: row.username,
                passhash: row.passhash,
                apiToken: row.api_token,
                useApiToken: !!row.use_api_token,
                ignoreSsl: !!row.ignore_ssl,
            });
            const data = await client.getSensors();
            callback({ ok: true, sensors: (data && data.sensors) || [] });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });
};
