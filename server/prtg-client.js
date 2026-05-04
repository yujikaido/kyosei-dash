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
        /**
         * Kyosei Dash — fetch historical channel data for a sensor.
         * Date format PRTG expects: "YYYY-MM-DD-HH-MM-SS" (in PRTG's local TZ).
         * @param {number|string} sensorId PRTG sensor objid
         * @param {Date} startDate beginning of window
         * @param {Date} endDate end of window
         * @param {number} avgSeconds aggregation window in seconds (0 = raw scan)
         * @returns {Promise<object>} PRTG historicdata response
         */
        async getHistory(sensorId, startDate, endDate, avgSeconds = 0) {
            const fmt = (d) => {
                const p = (n) => String(n).padStart(2, "0");
                return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
            };
            return prtgGet("/api/historicdata.json", {
                id: sensorId,
                sdate: fmt(startDate),
                edate: fmt(endDate),
                avg: avgSeconds,
                output: "json",
            });
        },
        /**
         * Kyosei Dash — fetch historical data as CSV. Unlike historicdata.json
         * (which collapses to the sensor's primary channel as 'value'), the
         * CSV endpoint returns one column per channel — the only PRTG API
         * that gives you all channels of a multi-channel sensor in one call.
         *
         * @param {number|string} sensorId PRTG sensor objid
         * @param {Date} startDate beginning of window
         * @param {Date} endDate end of window
         * @param {number} avgSeconds aggregation window in seconds (0 = raw)
         * @returns {Promise<string>} raw CSV text
         */
        async getHistoryCsv(sensorId, startDate, endDate, avgSeconds = 0) {
            const fmt = (d) => {
                const p = (n) => String(n).padStart(2, "0");
                return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
            };
            const url = `${baseUrl}/api/historicdata.csv`;
            try {
                const response = await axios.get(url, {
                    params: {
                        ...authParams(),
                        id: sensorId,
                        sdate: fmt(startDate),
                        edate: fmt(endDate),
                        avg: avgSeconds,
                    },
                    httpsAgent: agent,
                    timeout: 30000,
                    responseType: "text",
                    transformResponse: [(d) => d],   // raw text, no auto-parse
                });
                return String(response.data || "");
            } catch (err) {
                if (err.response) {
                    throw new Error(`PRTG ${err.response.status}: ${err.response.statusText}`);
                }
                throw new Error(err.message || "PRTG CSV history error");
            }
        },
    };
}

module.exports = { createPrtgClient };
