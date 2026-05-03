<template>
    <transition name="slide-fade" appear>
        <div>
            <div class="d-flex align-items-center mb-3">
                <h1 class="mb-0">{{ $t("Network") }}</h1>
                <div v-if="serversWithMaps.length" class="ms-auto">
                    <button
                        v-if="serversWithMaps.length === 1"
                        class="btn btn-outline-primary"
                        @click="openMap(serversWithMaps[0])"
                    >
                        <font-awesome-icon icon="map" /> Network Map
                    </button>
                    <div v-else class="dropdown">
                        <button class="btn btn-outline-primary dropdown-toggle" type="button" data-bs-toggle="dropdown">
                            <font-awesome-icon icon="map" /> Network Map
                        </button>
                        <ul class="dropdown-menu dropdown-menu-end">
                            <li v-for="s in serversWithMaps" :key="s.id">
                                <a class="dropdown-item" href="#" @click.prevent="openMap(s)">{{ s.name }}</a>
                            </li>
                        </ul>
                    </div>
                </div>
            </div>
            <p class="text-muted">{{ $t("Live view of all PRTG-backed monitors. Uses the latest heartbeat per sensor.") }}</p>

            <!-- Kyosei Dash — embedded PRTG map modal -->
            <div ref="mapEl" class="modal fade" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-fullscreen">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">
                                <font-awesome-icon icon="map" />
                                Network Map<span v-if="activeMap"> — {{ activeMap.name }}</span>
                            </h5>
                            <a v-if="activeMap" :href="activeMap.mapUrl" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-outline-secondary ms-auto me-2">
                                Open in new tab
                            </a>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body p-0">
                            <iframe
                                v-if="activeMap"
                                :src="activeMap.mapUrl"
                                class="w-100 h-100 border-0"
                                title="PRTG network map"
                            ></iframe>
                        </div>
                    </div>
                </div>
            </div>

            <div v-if="!items.length" class="shadow-box big-padding text-center text-muted">
                No PRTG monitors with recent channel data yet.
            </div>

            <div v-else class="row g-3">
                <div class="col-12 col-md-6">
                    <div class="shadow-box big-padding">
                        <h3 class="mb-3">Top 10 by throughput (Mbps total)</h3>
                        <ol class="mb-0">
                            <li v-for="r in topThroughput" :key="r.id">
                                <router-link :to="`/dashboard/${r.id}`">{{ r.name }}</router-link>
                                — <strong>{{ fmtMbps(r.total) }}</strong>
                                <span class="text-muted small">
                                    (↓ {{ fmtMbps(r.inBps) }} / ↑ {{ fmtMbps(r.outBps) }})
                                </span>
                            </li>
                        </ol>
                        <p v-if="!topThroughput.length" class="text-muted mb-0">No bandwidth channels detected.</p>
                    </div>
                </div>
                <div class="col-12 col-md-6">
                    <div class="shadow-box big-padding">
                        <h3 class="mb-3">Highest latency</h3>
                        <ol class="mb-0">
                            <li v-for="r in topLatency" :key="r.id">
                                <router-link :to="`/dashboard/${r.id}`">{{ r.name }}</router-link>
                                — <strong>{{ r.latency.toFixed(1) }} ms</strong>
                            </li>
                        </ol>
                        <p v-if="!topLatency.length" class="text-muted mb-0">No latency channels detected.</p>
                    </div>
                </div>
                <div class="col-12 col-md-6">
                    <div class="shadow-box big-padding">
                        <h3 class="mb-3">Packet loss leaderboard</h3>
                        <ol class="mb-0">
                            <li v-for="r in topLoss" :key="r.id">
                                <router-link :to="`/dashboard/${r.id}`">{{ r.name }}</router-link>
                                — <strong>{{ r.loss.toFixed(1) }}%</strong>
                            </li>
                        </ol>
                        <p v-if="!topLoss.length" class="text-muted mb-0">No packet-loss channels detected.</p>
                    </div>
                </div>
                <div class="col-12 col-md-6">
                    <div class="shadow-box big-padding">
                        <h3 class="mb-3">Interface errors</h3>
                        <ol class="mb-0">
                            <li v-for="r in topErrors" :key="r.id">
                                <router-link :to="`/dashboard/${r.id}`">{{ r.name }}</router-link>
                                — <strong>{{ r.errors }}</strong>
                            </li>
                        </ol>
                        <p v-if="!topErrors.length" class="text-muted mb-0">No error counters detected.</p>
                    </div>
                </div>
            </div>
        </div>
    </transition>
</template>

<script>
function findChannel(channels, predicates) {
    const keys = Object.keys(channels || {});
    for (const p of predicates) {
        const k = keys.find((key) => p.test(key.toLowerCase()));
        if (k && typeof channels[k] === "number") return channels[k];
    }
    return null;
}

import { Modal } from "bootstrap";

export default {
    data() {
        return {
            items: [],
            timer: null,
            servers: [],
            activeMap: null,
            mapInstance: null,
        };
    },
    computed: {
        /** Kyosei Dash — PRTG servers that have a map URL configured */
        serversWithMaps() {
            return this.servers.filter((s) => s.mapUrl && s.mapUrl.trim());
        },
        topThroughput() {
            return this.items
                .map((it) => {
                    // Cast a wide net — PRTG channel names vary wildly across sensor types
                    const inBps = findChannel(it.channels, [/(traffic|bandwidth).*in|inbound|^in\b|received|download|rx/i]) || 0;
                    const outBps = findChannel(it.channels, [/(traffic|bandwidth).*out|outbound|^out\b|sent|upload|tx/i]) || 0;
                    return { ...it, inBps, outBps, total: inBps + outBps };
                })
                .filter((r) => r.total > 0)
                .sort((a, b) => b.total - a.total)
                .slice(0, 10);
        },
        topLatency() {
            return this.items
                .map((it) => ({ ...it, latency: findChannel(it.channels, [/avg.*ping|avg.*ms|latency|^ping|response.*time|rtt/i]) || 0 }))
                .filter((r) => r.latency > 0)
                .sort((a, b) => b.latency - a.latency)
                .slice(0, 10);
        },
        topLoss() {
            return this.items
                .map((it) => ({ ...it, loss: findChannel(it.channels, [/loss|packetloss|drop/i]) || 0 }))
                .filter((r) => r.loss > 0)
                .sort((a, b) => b.loss - a.loss)
                .slice(0, 10);
        },
        topErrors() {
            return this.items
                .map((it) => ({ ...it, errors: findChannel(it.channels, [/errors?|crc|fault/i]) || 0 }))
                .filter((r) => r.errors > 0)
                .sort((a, b) => b.errors - a.errors)
                .slice(0, 10);
        },
    },
    mounted() {
        this.load();
        this.loadServers();
        this.timer = setInterval(this.load, 30000);
    },
    beforeUnmount() {
        if (this.timer) clearInterval(this.timer);
    },
    methods: {
        load() {
            this.$root.getSocket().emit("getNetworkOverview", (res) => {
                if (res && res.ok) this.items = res.items || [];
            });
        },
        /** Kyosei Dash — fetch PRTG server list to find which ones have map URLs */
        loadServers() {
            this.$root.getSocket().emit("getPrtgServerList", (res) => {
                if (res && res.ok) this.servers = res.list || [];
            });
        },
        /**
         * Kyosei Dash — open the embedded PRTG map for the chosen server.
         * @param {object} s server { name, mapUrl }
         * @returns {void}
         */
        openMap(s) {
            this.activeMap = s;
            if (!this.mapInstance) {
                this.mapInstance = new Modal(this.$refs.mapEl);
            }
            this.mapInstance.show();
        },
        fmtMbps(bps) {
            if (!bps) return "0 Mbps";
            const mbps = bps / 1_000_000;
            if (mbps >= 1000) return `${(mbps / 1000).toFixed(2)} Gbps`;
            if (mbps >= 1) return `${mbps.toFixed(1)} Mbps`;
            return `${(bps / 1000).toFixed(1)} Kbps`;
        },
    },
};
</script>
