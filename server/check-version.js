const { setSetting, setting } = require("./util-server");
const axios = require("axios");
const compareVersions = require("compare-versions");
const { log } = require("../src/util");

exports.version = require("../package.json").version;
exports.latestVersion = null;

// How much time in ms to wait between update checks
const UPDATE_CHECKER_INTERVAL_MS = 1000 * 60 * 60 * 48;
const UPDATE_CHECKER_LATEST_VERSION_URL = "https://uptime.kuma.pet/version";

let interval;

exports.startInterval = () => {
    // Kyosei Dash — Kuma's upstream version endpoint reports Kuma's release
    // numbers, which are always "newer" than our 1.0.0-beta and would trigger
    // a misleading "New Update" banner pointing at louislam's GitHub.
    // Disabled here. To re-enable later, point UPDATE_CHECKER_LATEST_VERSION_URL
    // at a Kyosei-controlled endpoint that returns { slow, beta } JSON.
    log.debug("update-checker", "Update checker disabled in Kyosei Dash fork");
};

/**
 * Enable the check update feature
 * @param {boolean} value Should the check update feature be enabled?
 * @returns {Promise<void>}
 */
exports.enableCheckUpdate = async (value) => {
    await setSetting("checkUpdate", value);

    clearInterval(interval);

    if (value) {
        exports.startInterval();
    }
};

exports.socket = null;
