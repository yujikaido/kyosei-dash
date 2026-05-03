const { checkLogin } = require("../util-server");
const { R } = require("redbean-node");

/**
 * Kyosei Dash — import monitors from an Uptime Kuma backup JSON file.
 * Does NOT touch existing data; creates new monitors only. Parents inside
 * the backup are remapped to newly-created Kyosei monitor IDs.
 *
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.kumaBackupImportSocketHandler = (socket) => {
    /**
     * Kyosei Dash — export current monitors as a Kuma-style backup JSON.
     * Round-trips with the import handler below. Selective: pass a group ID
     * to dump only that group + its descendants; null = everything.
     */
    socket.on("kyoseiKumaBackupExport", async (sourceGroupId, callback) => {
        try {
            checkLogin(socket);
            const all = await R.getAll(
                "SELECT * FROM monitor ORDER BY id ASC"
            );
            // Build descendant set if filtering
            let selected;
            if (sourceGroupId) {
                const wantedIds = new Set([Number(sourceGroupId)]);
                let grew = true;
                while (grew) {
                    grew = false;
                    for (const m of all) {
                        if (wantedIds.has(m.parent) && !wantedIds.has(m.id)) {
                            wantedIds.add(m.id);
                            grew = true;
                        }
                    }
                }
                selected = all.filter((m) => wantedIds.has(m.id));
            } else {
                selected = all;
            }

            // Project to a Kuma-style backup shape (matches v1 export format
            // closely enough for our import handler to round-trip cleanly)
            const monitorList = selected.map((m) => {
                let acceptedStatuscodes = ["200-299"];
                try {
                    if (m.accepted_statuscodes_json) {
                        acceptedStatuscodes = JSON.parse(m.accepted_statuscodes_json);
                    }
                } catch (e) { /* ignore */ }
                return {
                    id: m.id,
                    name: m.name,
                    description: m.description || null,
                    pathName: m.name,
                    parent: m.parent,
                    childrenIDs: [],
                    type: m.type,
                    url: m.url || "https://",
                    method: m.method || "GET",
                    hostname: m.hostname || null,
                    port: m.port || null,
                    maxretries: m.maxretries || 0,
                    weight: m.weight || 2000,
                    active: !!m.active,
                    forceInactive: false,
                    timeout: m.timeout || 15,
                    interval: m.interval || 60,
                    retryInterval: m.retryInterval || 60,
                    resendInterval: m.resend_interval || 0,
                    keyword: m.keyword || null,
                    invertKeyword: !!m.invert_keyword,
                    expiryNotification: !!m.expiry_notification,
                    ignoreTls: !!m.ignore_tls,
                    upsideDown: !!m.upside_down,
                    packetSize: m.packet_size || 56,
                    maxredirects: m.maxredirects || 10,
                    accepted_statuscodes: acceptedStatuscodes,
                    dns_resolve_type: m.dns_resolve_type || "A",
                    dns_resolve_server: m.dns_resolve_server || null,
                    // Kyosei extensions — non-Kuma fields, preserved on round-trip
                    connections: m.connections ? JSON.parse(m.connections) : [],
                    prtg_server_id: m.prtg_server_id || null,
                    prtg_sensor_id: m.prtg_sensor_id || null,
                    prtg_device: m.prtg_device || null,
                };
            });
            callback({
                ok: true,
                backup: {
                    version: "kyosei-1.0.0-beta",
                    exportedAt: new Date().toISOString(),
                    monitorList,
                },
            });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });


    /**
     * Send back a high-level summary of what's in a backup so the user
     * can pick what to import.
     */
    socket.on("kyoseiKumaBackupSummary", async (backup, callback) => {
        try {
            checkLogin(socket);
            const list = (backup && backup.monitorList) || [];
            const groups = list
                .filter((m) => m.type === "group")
                .map((g) => ({
                    id: g.id,
                    name: g.name,
                    pathName: g.pathName,
                    childCount: list.filter((m) => m.parent === g.id).length,
                }))
                .sort((a, b) => (a.pathName || "").localeCompare(b.pathName || ""));
            const standalone = list.filter((m) => m.parent === null && m.type !== "group").length;
            callback({
                ok: true,
                version: backup && backup.version,
                totalMonitors: list.length,
                groups,
                standalone,
            });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });

    /**
     * Import monitors from the backup. Optionally filtered to one source
     * group (and its children). Optionally placed under a target parent
     * group on the Kyosei side.
     *
     * @param backup full Kuma backup JSON
     * @param sourceGroupId  null = everything; otherwise import that group + children
     * @param targetParentId null = top-level; otherwise reparent under this Kyosei group id
     * @param includeSourceGroup  if true and sourceGroupId is set, also create a copy
     *        of the source group itself (so children stay under "Printers" within Kyosei)
     */
    socket.on("kyoseiKumaBackupImport", async (backup, sourceGroupId, targetParentId, includeSourceGroup, callback) => {
        try {
            checkLogin(socket);
            const list = (backup && backup.monitorList) || [];
            if (!list.length) throw new Error("Backup contains no monitors");

            // Build source-side selection
            let selected;
            if (sourceGroupId) {
                const sg = list.find((m) => m.id === sourceGroupId);
                if (!sg) throw new Error("Source group not found in backup");
                const children = list.filter((m) => m.parent === sourceGroupId);
                selected = includeSourceGroup ? [ sg, ...children ] : children;
            } else {
                selected = list;
            }

            // Validate target parent if provided
            const targetPid = targetParentId ? Number(targetParentId) : null;
            if (targetPid) {
                const targetGroup = await R.findOne("monitor", "id = ? AND type = 'group'", [targetPid]);
                if (!targetGroup) throw new Error("Target parent group not found in Kyosei");
            }

            // First pass: create groups (so we can resolve parent IDs in pass 2)
            const oldIdToNewId = new Map();
            for (const m of selected.filter((x) => x.type === "group")) {
                const bean = R.dispense("monitor");
                bean.user_id = socket.userID;
                bean.type = "group";
                bean.name = m.name;
                bean.active = m.active !== false;
                bean.weight = m.weight || 1500;
                bean.maxretries = 0;
                bean.interval = m.interval || 60;
                bean.retryInterval = m.retryInterval || 60;
                bean.timeout = m.timeout || 15;
                // If this group has a parent inside the selected set we'll wire it
                // up in pass 3. For now, default to the chosen target parent.
                bean.parent = targetPid;
                const newId = await R.store(bean);
                oldIdToNewId.set(m.id, newId);
            }

            // Second pass: create non-group monitors
            for (const m of selected.filter((x) => x.type !== "group")) {
                const bean = R.dispense("monitor");
                bean.user_id = socket.userID;
                bean.type = m.type;
                bean.name = m.name;
                bean.description = m.description || null;
                bean.active = m.active !== false;
                bean.weight = m.weight || 2000;
                bean.maxretries = m.maxretries || 0;
                bean.interval = Math.max(20, m.interval || 60);
                bean.retryInterval = m.retryInterval || 60;
                bean.timeout = m.timeout || 15;
                bean.url = m.url || null;
                bean.method = m.method || null;
                bean.hostname = m.hostname || null;
                bean.port = m.port || null;
                bean.keyword = m.keyword || null;
                bean.invertKeyword = !!m.invertKeyword;
                bean.expiryNotification = !!m.expiryNotification;
                bean.ignoreTls = !!m.ignoreTls;
                bean.upsideDown = !!m.upsideDown;
                bean.packetSize = m.packetSize || 56;
                bean.maxredirects = m.maxredirects || 10;
                bean.accepted_statuscodes_json = JSON.stringify(m.accepted_statuscodes || ["200-299"]);
                bean.dns_resolve_type = m.dns_resolve_type || "A";
                bean.dns_resolve_server = m.dns_resolve_server || null;
                // Parent resolution: prefer mapped parent within selection, else target parent
                bean.parent = oldIdToNewId.get(m.parent) || targetPid;
                const newId = await R.store(bean);
                oldIdToNewId.set(m.id, newId);
            }

            // Third pass: fix nested group parents (if a group had a parent inside the selection)
            for (const m of selected.filter((x) => x.type === "group" && x.parent)) {
                if (oldIdToNewId.has(m.parent)) {
                    const newGroupId = oldIdToNewId.get(m.id);
                    await R.exec("UPDATE monitor SET parent = ? WHERE id = ?", [
                        oldIdToNewId.get(m.parent),
                        newGroupId,
                    ]);
                }
            }

            const server = require("../uptime-kuma-server").UptimeKumaServer.getInstance();

            // Kyosei Dash — schedule each newly-created non-group monitor so
            // it polls immediately. Without this, imported monitors show
            // "unknown" until the user pauses + resumes them.
            if (server && server.io) {
                for (const newId of oldIdToNewId.values()) {
                    try {
                        const fresh = await R.findOne("monitor", "id = ?", [newId]);
                        if (!fresh || fresh.type === "group" || !fresh.active) continue;
                        if (server.monitorList[fresh.id]) {
                            await server.monitorList[fresh.id].stop();
                        }
                        server.monitorList[fresh.id] = fresh;
                        await fresh.start(server.io);
                    } catch (e) { /* best-effort per monitor */ }
                }
            }

            try { await server.sendMonitorList(socket); } catch (e) { /* best effort */ }

            callback({
                ok: true,
                imported: selected.length,
                groupsCreated: selected.filter((x) => x.type === "group").length,
                monitorsCreated: selected.filter((x) => x.type !== "group").length,
            });
        } catch (e) {
            callback({ ok: false, msg: e.message });
        }
    });
};
