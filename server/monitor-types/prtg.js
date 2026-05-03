const { MonitorType } = require("./monitor-type");
const { UP, DOWN, PENDING, log } = require("../../src/util");
const { R } = require("redbean-node");
const { createPrtgClient } = require("../prtg-client");

/**
 * Kyosei Dash — PRTG sensor monitor type.
 *
 * Reads a PRTG sensor via the JSON API and maps PRTG status to Kuma status.
 * Writes all sensor channels into heartbeat.channels (JSON) for later charting.
 *
 * PRTG status codes (from getsensordetails): 1=none, 2=scanning, 3=up, 4=warning,
 * 5=down, 6=no probe, 7=paused by user, 8=paused by dependency, 9=paused by schedule,
 * 10=unusual, 11=not licensed, 12=paused until, 13=down acknowledged, 14=down partial
 */
class PrtgMonitorType extends MonitorType {
    name = "prtg";

    async check(monitor, heartbeat, _server) {
        if (!monitor.prtg_server_id || !monitor.prtg_sensor_id) {
            heartbeat.status = DOWN;
            heartbeat.msg = "PRTG server/sensor not configured";
            return;
        }

        const srv = await R.findOne("prtg_server", "id = ?", [monitor.prtg_server_id]);
        if (!srv) {
            heartbeat.status = DOWN;
            heartbeat.msg = "PRTG server not found";
            return;
        }

        const client = createPrtgClient({
            url: srv.url,
            username: srv.username,
            passhash: srv.passhash,
            apiToken: srv.api_token,
            useApiToken: !!srv.use_api_token,
            ignoreSsl: !!srv.ignore_ssl,
        });

        const t0 = Date.now();
        const details = await client.getSensorDetails(monitor.prtg_sensor_id);
        heartbeat.ping = Date.now() - t0;

        const sd = details && details.sensordata ? details.sensordata : details;
        const statusId = Number(sd && (sd.status_raw || sd.statusid || sd.status));
        const message = (sd && sd.lastmessage) || (sd && sd.statusmessage) || "";

        switch (statusId) {
            case 3:
            case 10:
                heartbeat.status = UP;
                break;
            case 2:
            case 4:
                heartbeat.status = PENDING;
                break;
            case 7:
            case 8:
            case 9:
            case 12:
                heartbeat.status = DOWN;
                heartbeat.msg = `Paused — ${message}`;
                break;
            case 13:
                heartbeat.status = DOWN;
                heartbeat.msg = `Acknowledged — ${message}`;
                break;
            case 5:
            case 11:
            case 14:
            default:
                heartbeat.status = DOWN;
                break;
        }
        if (!heartbeat.msg) {
            heartbeat.msg = message || `PRTG status ${statusId}`;
        }

        try {
            const chResp = await client.getSensorChannels(monitor.prtg_sensor_id);
            const rows = (chResp && chResp.channels) || [];
            const channels = {};
            for (const row of rows) {
                // PRTG channels: `name` is the human label; objid is fallback
                const key = String(row.name || row.objid).trim();
                if (!key) continue;
                const raw = row.lastvalue_raw;
                const val = raw === undefined || raw === null || raw === "" ? row.lastvalue : raw;
                const num = Number(val);
                channels[key] = isNaN(num) ? val : num;
            }
            heartbeat.channels = JSON.stringify(channels);
        } catch (e) {
            log.debug("prtg", `channel fetch failed for sensor ${monitor.prtg_sensor_id}: ${e.message}`);
        }
    }
}

module.exports = { PrtgMonitorType };
