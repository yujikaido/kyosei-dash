<template>
    <div>
        <div class="d-flex justify-content-between align-items-center mb-2">
            <strong>{{ title }}</strong>
            <select v-model.number="hours" class="form-select form-select-sm w-auto" @change="load">
                <option :value="1">1h</option>
                <option :value="6">6h</option>
                <option :value="24">24h</option>
                <option :value="168">7d</option>
            </select>
        </div>
        <div v-if="!series.length" class="text-muted small">No channel history yet.</div>
        <Line v-else :data="chartData" :options="chartOptions" />
    </div>
</template>

<script>
import { Chart, LineController, LineElement, PointElement, LinearScale, TimeScale, Filler, Tooltip, Legend } from "chart.js";
import "chartjs-adapter-dayjs-4";
import { Line } from "vue-chartjs";

Chart.register(LineController, LineElement, PointElement, LinearScale, TimeScale, Filler, Tooltip, Legend);

const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#EC4899", "#14B8A6", "#F97316"];

export default {
    components: { Line },
    props: {
        monitorId: { type: Number, required: true },
    },
    data() {
        return {
            hours: 24,
            points: [],
        };
    },
    computed: {
        /** Distinct channel keys sorted */
        channelKeys() {
            const keys = new Set();
            for (const p of this.points) {
                for (const k of Object.keys(p.channels || {})) keys.add(k);
            }
            return [ ...keys ].sort();
        },
        series() {
            return this.channelKeys.map((k, i) => ({
                label: k,
                borderColor: COLORS[i % COLORS.length],
                backgroundColor: COLORS[i % COLORS.length] + "33",
                fill: this.chartKind === "bandwidth",
                data: this.points
                    .map((p) => ({ x: new Date(p.t), y: typeof p.channels[k] === "number" ? p.channels[k] : null }))
                    .filter((d) => d.y !== null),
                tension: 0.2,
                borderWidth: 2,
                pointRadius: 0,
            }));
        },
        chartKind() {
            const ks = this.channelKeys.map((k) => k.toLowerCase());
            if (ks.some((k) => k.includes("bps") || k.includes("traffic") || k.includes("bandwidth") || /\b(rx|tx|inbound|outbound|received|sent)\b/.test(k))) return "bandwidth";
            if (ks.some((k) => k.includes("latency") || k.includes("jitter") || k.includes("ping") || k.includes("rtt"))) return "latency";
            return "generic";
        },
        /**
         * Kyosei Dash — auto-scale y-axis for bandwidth charts so values
         * read as kbit/s, Mbit/s, or Gbit/s instead of raw bps.
         * Returns null for non-bandwidth charts (no scaling applied).
         */
        bandwidthScale() {
            if (this.chartKind !== "bandwidth") return null;
            let maxVal = 0;
            for (const p of this.points) {
                for (const v of Object.values(p.channels || {})) {
                    if (typeof v === "number" && v > maxVal) maxVal = v;
                }
            }
            if (maxVal >= 1e9) return { div: 1e9, unit: "Gbit/s" };
            if (maxVal >= 1e6) return { div: 1e6, unit: "Mbit/s" };
            if (maxVal >= 1e3) return { div: 1e3, unit: "kbit/s" };
            return { div: 1, unit: "bit/s" };
        },
        title() {
            return {
                bandwidth: "Bandwidth",
                latency: "Latency / Jitter",
                generic: "Channels",
            }[this.chartKind];
        },
        chartData() {
            return { datasets: this.series };
        },
        chartOptions() {
            // PRTG-style date+time labels — "4/25 4:00 PM" style across ranges.
            const isMultiDay = this.hours >= 24;
            const bw = this.bandwidthScale;
            return {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                scales: {
                    x: {
                        type: "time",
                        time: {
                            tooltipFormat: "MMM D, YYYY h:mm:ss A",
                            displayFormats: {
                                minute: "h:mm A",
                                hour: isMultiDay ? "M/D h:mm A" : "h:mm A",
                                day: "M/D",
                            },
                        },
                        ticks: {
                            autoSkip: true,
                            // PRTG-style: angled labels allow far more ticks
                            // to fit without overlap, and the rightmost label
                            // sits close to "now" instead of trailing hours behind.
                            maxTicksLimit: isMultiDay ? 24 : 12,
                            minRotation: isMultiDay ? 45 : 0,
                            maxRotation: isMultiDay ? 45 : 0,
                            includeBounds: true,
                        },
                    },
                    y: {
                        beginAtZero: true,
                        title: bw ? { display: true, text: bw.unit } : { display: false },
                        ticks: bw ? {
                            callback: (v) => {
                                const scaled = v / bw.div;
                                // Drop trailing .0; show 1 decimal for sub-10 values
                                return scaled >= 10 ? scaled.toLocaleString() : scaled.toFixed(1);
                            },
                        } : {},
                    },
                },
                plugins: {
                    legend: { display: true, position: "top" },
                    tooltip: {
                        callbacks: bw ? {
                            label: (ctx) => {
                                const v = ctx.parsed.y;
                                if (typeof v !== "number") return ctx.dataset.label;
                                const scaled = v / bw.div;
                                const fmt = scaled >= 10 ? scaled.toLocaleString(undefined, { maximumFractionDigits: 0 }) : scaled.toFixed(2);
                                return `${ctx.dataset.label}: ${fmt} ${bw.unit}`;
                            },
                        } : {},
                    },
                },
            };
        },
    },
    mounted() {
        this.load();
    },
    methods: {
        load() {
            this.$root.getSocket().emit("getChannelHistory", this.monitorId, this.hours, (res) => {
                if (res && res.ok) {
                    this.points = res.points || [];
                }
            });
        },
    },
};
</script>

<style scoped>
div :deep(canvas) { height: 260px !important; }
</style>
