const axios = require("axios");
const https = require("https");

/**
 * Kyosei Dash — lightweight PRTG JSON API client.
 * Ported from PRTG Dash.
 *
 * @param {object} config { url, username, passhash, apiToken, useApiToken, ignoreSsl }
 * @returns {object} client with prtgGet/getSensors/getDevices/getHistory/getSensorDetails
 */
function createPrtgClient(config) {
    const baseUrl = String(config.url || "").replace(/\/+$/, "");
    const agent = config.ignoreSsl
        ? new https.Agent({ rejectUnauthorized: false })
        : undefined;

    function authParams() {
        if (config.useApiToken) {
            return { apitoken: config.apiToken };
        }
        return { username: config.username, passhash: config.passhash };
    }

    async function prtgGet(apiPath, params = {}) {
        const url = `${baseUrl}${apiPath}`;
        try {
            const response = await axios.get(url, {
                params: { ...authParams(), ...params },
                httpsAgent: agent,
                timeout: 15000,
            });
            return response.data;
        } catch (err) {
            if (err.response) {
                throw new Error(`PRTG ${err.response.status}: ${err.response.statusText}`);
            }
            if (err.code === "ECONNREFUSED") {
                throw new Error("PRTG connection refused");
            }
            if (err.code === "ENOTFOUND") {
                throw new Error("PRTG hostname not found");
            }
            if (err.code === "CERT_HAS_EXPIRED" || err.code === "UNABLE_TO_VERIFY_LEAF_SIGNATURE") {
                throw new Error("PRTG SSL error — enable Ignore SSL");
            }
            throw new Error(err.message || "PRTG unknown error");
        }
    }

    return {
        prtgGet,
        async getSensors() {
            return prtgGet("/api/table.json", {
                content: "sensors",
                output: "json",
                columns: "objid,probe,group,device,sensor,status,message,lastvalue,priority,interval",
                count: 5000,
            });
        },
        async getDevices() {
            return prtgGet("/api/table.json", {
                content: "devices",
                output: "json",
                columns: "objid,probe,group,device,host,status,message,totalsens",
                count: 2000,
            });
        },
        async getGroups() {
            return prtgGet("/api/table.json", {
                content: "groups",
                output: "json",
                columns: "objid,probe,group,status,message,totalsens",
                count: 2000,
            });
        },
        async getSensorDetails(sensorId) {
            return prtgGet("/api/getsensordetails.json", { id: sensorId });
        },
        async getSensorChannels(sensorId) {
            // Returns channel list with current values.
            // PRTG's "channels" content uses `name` for the channel label,
            // NOT `channel` (which is for the "sensors" content). Using the
            // wrong column makes channel keys come back as numeric IDs.
            return prtgGet("/api/table.json", {
                content: "channels",
                output: "json",
                columns: "objid,name,lastvalue,lastvalue_raw",
                id: sensorId,
            });
        },
        async getStatus() {
            return prtgGet("/api/getstatus.json", {});
        },
    };
}

module.exports = { createPrtgClient };
