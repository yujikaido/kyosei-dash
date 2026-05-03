<template>
    <!-- Kyosei Dash — no outer transition: this component is rendered inside
         Settings.vue's own transition wrapper, and double-nesting prevents
         content from showing on /settings/backup. -->
    <div>
        <h1 class="mb-3">Backup &amp; Restore</h1>
            <p class="text-muted">
                Kuma 2.x dropped JSON backup/restore — Kyosei brings it back. Round-trip
                JSON containing all your monitors and groups, plus Kyosei extras
                (connection launchers, PRTG bindings).
            </p>

            <!-- Kyosei Dash — Export section -->
            <div class="shadow-box big-padding mb-3">
                <h3 class="mb-3">Export</h3>
                <label class="form-label">What to export</label>
                <select v-model.number="exportGroupId" class="form-select mb-3">
                    <option :value="null">Everything ({{ totalMonitorCount }} monitors)</option>
                    <option v-for="g in kyoseiGroups" :key="g.id" :value="g.id">
                        {{ g.name }} (and its children)
                    </option>
                </select>
                <button class="btn btn-primary" :disabled="exporting" @click="runExport">
                    {{ exporting ? "Exporting…" : "Download backup JSON" }}
                </button>
                <p class="text-muted small mt-2 mb-0">
                    Saves as <code>kyosei-backup-YYYY-MM-DD.json</code> in your browser's downloads.
                </p>
            </div>

            <h3 class="mb-3 mt-4">Import / Restore</h3>
            <p class="text-muted">
                Load a Kyosei or Uptime Kuma backup JSON. Existing monitors are not touched —
                this only creates new ones, so it's also safe for selective restore.
            </p>

            <div class="shadow-box big-padding mb-3">
                <label class="form-label">Backup JSON file</label>
                <input type="file" accept="application/json,.json" class="form-control" @change="onFile" />
                <p v-if="loadError" class="text-danger small mt-2 mb-0">{{ loadError }}</p>
            </div>

            <div v-if="summary" class="shadow-box big-padding mb-3">
                <p class="mb-2">
                    Backup version: <strong>{{ summary.version || "unknown" }}</strong> ·
                    Monitors: <strong>{{ summary.totalMonitors }}</strong> ·
                    Top-level standalone: {{ summary.standalone }}
                </p>

                <label class="form-label">Source — what to import</label>
                <select v-model.number="sourceGroupId" class="form-select mb-3">
                    <option :value="null">Everything in the backup ({{ summary.totalMonitors }} monitors)</option>
                    <option v-for="g in summary.groups" :key="g.id" :value="g.id">
                        {{ g.pathName || g.name }} ({{ g.childCount }} children)
                    </option>
                </select>

                <div v-if="sourceGroupId" class="form-check mb-3">
                    <input id="include-source-group" v-model="includeSourceGroup" class="form-check-input" type="checkbox" />
                    <label class="form-check-label" for="include-source-group">
                        Also create the source group itself (children stay under "{{ sourceGroupName }}" inside Kyosei)
                    </label>
                </div>

                <label class="form-label">Target parent group in Kyosei (optional)</label>
                <select v-model.number="targetParentId" class="form-select mb-3">
                    <option :value="null">— Top-level (no parent) —</option>
                    <option v-for="g in kyoseiGroups" :key="g.id" :value="g.id">{{ g.name }}</option>
                </select>

                <button class="btn btn-primary" :disabled="importing" @click="runImport">
                    {{ importing ? "Importing…" : "Import" }}
                </button>
                <div v-if="result" class="alert alert-success mt-3 mb-0">
                    Imported {{ result.imported }} item(s) — {{ result.groupsCreated }} group(s),
                    {{ result.monitorsCreated }} monitor(s).
                </div>
            </div>
    </div>
</template>

<script>
export default {
    data() {
        return {
            backup: null,
            summary: null,
            loadError: "",
            sourceGroupId: null,
            includeSourceGroup: true,
            targetParentId: null,
            importing: false,
            result: null,
            exportGroupId: null,
            exporting: false,
        };
    },
    computed: {
        kyoseiGroups() {
            return Object.values(this.$root.monitorList || {})
                .filter((m) => m.type === "group")
                .sort((a, b) => a.name.localeCompare(b.name));
        },
        totalMonitorCount() {
            return Object.keys(this.$root.monitorList || {}).length;
        },
        sourceGroupName() {
            if (!this.summary || !this.sourceGroupId) return "";
            const g = this.summary.groups.find((x) => x.id === this.sourceGroupId);
            return g ? (g.pathName || g.name) : "";
        },
    },
    methods: {
        runExport() {
            this.exporting = true;
            this.$root.getSocket().emit("kyoseiKumaBackupExport", this.exportGroupId, (res) => {
                this.exporting = false;
                if (!res || !res.ok) {
                    this.$root.toastError(res ? res.msg : "Export failed");
                    return;
                }
                const blob = new Blob([JSON.stringify(res.backup, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                const dt = new Date().toISOString().slice(0, 10);
                a.download = `kyosei-backup-${dt}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                this.$root.toastSuccess(`Exported ${res.backup.monitorList.length} monitor(s).`);
            });
        },
        onFile(ev) {
            this.loadError = "";
            this.summary = null;
            this.backup = null;
            const f = ev.target.files && ev.target.files[0];
            if (!f) return;
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    const obj = JSON.parse(reader.result);
                    if (!obj || !Array.isArray(obj.monitorList)) {
                        throw new Error("Not a valid Uptime Kuma backup (missing monitorList)");
                    }
                    this.backup = obj;
                    this.$root.getSocket().emit("kyoseiKumaBackupSummary", obj, (res) => {
                        if (res && res.ok) {
                            this.summary = res;
                        } else {
                            this.loadError = (res && res.msg) || "Failed to summarize backup";
                        }
                    });
                } catch (e) {
                    this.loadError = e.message;
                }
            };
            reader.readAsText(f);
        },
        runImport() {
            if (!this.backup) return;
            this.importing = true;
            this.result = null;
            this.$root.getSocket().emit(
                "kyoseiKumaBackupImport",
                this.backup,
                this.sourceGroupId,
                this.targetParentId,
                this.includeSourceGroup,
                (res) => {
                    this.importing = false;
                    if (res && res.ok) {
                        this.result = res;
                    } else {
                        this.$root.toastError(res ? res.msg : "Failed");
                    }
                }
            );
        },
    },
};
</script>
