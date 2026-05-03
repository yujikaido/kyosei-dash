<template>
    <transition name="slide-fade" appear>
        <div>
            <h1 class="mb-3">{{ $t("PRTG Import") }}</h1>
            <p class="text-muted">
                Walks the selected PRTG server's sensors. Pre-skips anything Kuma can monitor natively,
                pre-ticks anything only PRTG can do. Adjust per-row, then Import.
            </p>

            <div class="shadow-box big-padding mb-3">
                <label class="form-label">PRTG Server</label>
                <select v-model.number="serverId" class="form-select" @change="load">
                    <option :value="null" disabled>— {{ $t("Select") }} —</option>
                    <option v-for="s in servers" :key="s.id" :value="s.id">{{ s.name }} ({{ s.url }})</option>
                </select>
                <div class="form-text">
                    Configure servers under
                    <router-link to="/settings/prtg">Settings → PRTG Servers</router-link>.
                </div>
            </div>

            <div v-if="loading" class="text-muted">Loading sensor list…</div>

            <div v-if="sensors.length" class="shadow-box big-padding">
                <div class="d-flex align-items-center mb-2">
                    <strong>{{ sensors.length }}</strong>
                    <span class="text-muted ms-2">sensors — {{ tickedCount }} selected</span>
                    <div class="ms-auto">
                        <button class="btn btn-sm btn-outline-secondary me-2" @click="tickAll(true)">Select all</button>
                        <button class="btn btn-sm btn-outline-secondary me-2" @click="tickAll(false)">Clear</button>
                        <button class="btn btn-sm btn-outline-primary me-2" @click="tickPrtgOnly">PRTG-only</button>
                    </div>
                </div>
                <div class="table-responsive">
                    <table class="table table-sm align-middle">
                        <thead>
                            <tr>
                                <th></th>
                                <th>Sensor</th>
                                <th>Device</th>
                                <th>Host</th>
                                <th>Class</th>
                                <th>Interval</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr v-for="s in sensors" :key="s.objid" :class="{ 'text-muted': s.classification === 'kuma-native' && !s.preTicked }">
                                <td><input v-model="s.preTicked" type="checkbox" /></td>
                                <td>
                                    {{ s.sensor }}
                                    <span v-if="s.alreadyImported" class="badge bg-secondary ms-1">imported</span>
                                </td>
                                <td>{{ s.device }}</td>
                                <td>{{ s.host }}</td>
                                <td>
                                    <span v-if="s.classification === 'prtg-only'" class="badge bg-success">PRTG-only</span>
                                    <span v-else class="badge bg-warning text-dark">Kuma-native</span>
                                </td>
                                <td class="small text-muted">{{ s.interval }}</td>
                                <td class="small">{{ s.status }}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <button class="btn btn-primary" :disabled="!tickedCount || importing" @click="runImport">
                    {{ importing ? "Importing…" : `Import ${tickedCount} selected` }}
                </button>
                <div v-if="result" class="alert alert-success mt-3 mb-0">
                    Created {{ result.created }}, updated {{ result.updated }}.
                </div>
            </div>
        </div>
    </transition>
</template>

<script>
export default {
    data() {
        return {
            servers: [],
            serverId: null,
            sensors: [],
            loading: false,
            importing: false,
            result: null,
        };
    },
    computed: {
        tickedCount() { return this.sensors.filter((s) => s.preTicked).length; },
    },
    mounted() {
        this.$root.getSocket().emit("getPrtgServerList", (res) => {
            if (res && res.ok) {
                this.servers = res.list || [];
                if (this.servers.length === 1) {
                    this.serverId = this.servers[0].id;
                    this.load();
                }
            }
        });
    },
    methods: {
        load() {
            if (!this.serverId) return;
            this.loading = true;
            this.sensors = [];
            this.result = null;
            this.$root.getSocket().emit("prtgImportPreview", this.serverId, (res) => {
                this.loading = false;
                if (res.ok) {
                    this.sensors = res.sensors;
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },
        tickAll(v) { for (const s of this.sensors) s.preTicked = v; },
        tickPrtgOnly() {
            for (const s of this.sensors) s.preTicked = s.classification === "prtg-only";
        },
        runImport() {
            this.importing = true;
            this.result = null;
            const ids = this.sensors.filter((s) => s.preTicked).map((s) => s.objid);
            this.$root.getSocket().emit("prtgImportSensors", this.serverId, ids, (res) => {
                this.importing = false;
                if (res.ok) {
                    this.result = res;
                    this.load();
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },
    },
};
</script>
