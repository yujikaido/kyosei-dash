<template>
    <div>
        <p class="mb-3">{{ $t("Register PRTG servers. Credentials are stored server-side and never exposed to the client.") }}</p>

        <ul v-if="list.length" class="list-group mb-3" style="border-radius: 1rem">
            <li v-for="s in list" :key="s.id" class="list-group-item">
                <strong>{{ s.name }}</strong> — {{ s.url }}
                <span v-if="s.useApiToken" class="badge bg-secondary ms-2">API Token</span>
                <span v-else class="badge bg-secondary ms-2">{{ s.username }}</span>
                <span v-if="s.ignoreSsl" class="badge bg-warning ms-2">Ignore SSL</span>
                <br />
                <a href="#" @click.prevent="edit(s)">{{ $t("Edit") }}</a> |
                <a href="#" @click.prevent="testSaved(s)">{{ $t("Test") }}</a> |
                <a href="#" class="text-danger" @click.prevent="remove(s)">{{ $t("Delete") }}</a>
            </li>
        </ul>
        <p v-else class="text-muted">{{ $t("No PRTG servers configured yet.") }}</p>

        <button v-if="!editing" class="btn btn-primary" @click="edit({})">{{ $t("Add PRTG Server") }}</button>

        <form v-if="editing" class="shadow-box big-padding mt-3" @submit.prevent="save">
            <h4 class="mb-3">{{ form.id ? $t("Edit") : $t("Add PRTG Server") }}</h4>
            <div class="mb-3">
                <label class="form-label">{{ $t("Name") }}</label>
                <input v-model="form.name" type="text" class="form-control" required placeholder="Primary PRTG" />
            </div>
            <div class="mb-3">
                <label class="form-label">URL</label>
                <input v-model="form.url" type="url" class="form-control" required placeholder="https://prtg.example.com" />
            </div>
            <div class="form-check mb-3">
                <input id="use-api-token" v-model="form.useApiToken" class="form-check-input" type="checkbox" />
                <label class="form-check-label" for="use-api-token">{{ $t("Use API Token") }}</label>
            </div>
            <div v-if="!form.useApiToken" class="mb-3">
                <label class="form-label">{{ $t("Username") }}</label>
                <input v-model="form.username" type="text" class="form-control" autocomplete="off" />
            </div>
            <div v-if="!form.useApiToken" class="mb-3">
                <label class="form-label">Passhash</label>
                <input v-model="form.passhash" type="password" class="form-control" autocomplete="new-password" :placeholder="form.id ? $t('Leave blank to keep existing') : ''" />
                <div class="form-text">PRTG passhash (Setup → Account Settings → My Account → Show Passhash).</div>
            </div>
            <div v-if="form.useApiToken" class="mb-3">
                <label class="form-label">API Token</label>
                <input v-model="form.apiToken" type="password" class="form-control" autocomplete="new-password" :placeholder="form.id ? $t('Leave blank to keep existing') : ''" />
            </div>
            <div class="form-check mb-3">
                <input id="ignore-ssl" v-model="form.ignoreSsl" class="form-check-input" type="checkbox" />
                <label class="form-check-label" for="ignore-ssl">{{ $t("Ignore SSL certificate errors") }}</label>
            </div>
            <div class="mb-3">
                <label class="form-label">PRTG Network Map URL <span class="text-muted">(optional)</span></label>
                <input v-model="form.mapUrl" type="url" class="form-control" placeholder="https://prtg.example.com/public/mapshow.htm?id=3165&mapid=…" />
                <div class="form-text">
                    Paste a PRTG public-map URL — adds a <strong>Network Map</strong> button to the Network page that opens this map in a popup.
                    In PRTG: open the map → <em>Settings → Public Access → Allow public access</em>, then copy the public URL it gives you.
                </div>
            </div>
            <div v-if="testMsg" class="alert" :class="testOk ? 'alert-success' : 'alert-danger'">{{ testMsg }}</div>
            <button type="button" class="btn btn-outline-secondary me-2" @click="test">{{ $t("Test Connection") }}</button>
            <button type="submit" class="btn btn-primary me-2">{{ $t("Save") }}</button>
            <button type="button" class="btn btn-link" @click="cancel">{{ $t("Cancel") }}</button>
        </form>
    </div>
</template>

<script>
export default {
    data() {
        return {
            list: [],
            editing: false,
            form: {},
            testMsg: "",
            testOk: false,
        };
    },
    mounted() {
        this.load();
    },
    methods: {
        load() {
            this.$root.getSocket().emit("getPrtgServerList", (res) => {
                if (res && res.ok) {
                    this.list = res.list || [];
                }
            });
        },
        edit(s) {
            this.form = {
                id: s.id || null,
                name: s.name || "",
                url: s.url || "",
                username: s.username || "",
                passhash: "",
                apiToken: "",
                useApiToken: !!s.useApiToken,
                ignoreSsl: !!s.ignoreSsl,
                mapUrl: s.mapUrl || "",
            };
            this.testMsg = "";
            this.editing = true;
        },
        cancel() {
            this.editing = false;
            this.testMsg = "";
        },
        save() {
            this.$root.getSocket().emit("savePrtgServer", this.form, this.form.id, (res) => {
                if (res.ok) {
                    this.$root.toastSuccess("Saved.");
                    this.editing = false;
                    this.load();
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },
        remove(s) {
            if (!confirm(`Delete PRTG server "${s.name}"?`)) return;
            this.$root.getSocket().emit("deletePrtgServer", s.id, (res) => {
                if (res.ok) {
                    this.load();
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },
        test() {
            this.testMsg = "Testing…";
            this.testOk = false;
            this.$root.getSocket().emit("testPrtgServer", this.form, (res) => {
                this.testOk = res.ok;
                this.testMsg = res.ok ? `OK — PRTG ${res.version || ""}`.trim() : `Failed: ${res.msg}`;
            });
        },
        testSaved(s) {
            this.$root.getSocket().emit("testPrtgServer", { id: s.id, url: s.url, useApiToken: s.useApiToken, ignoreSsl: s.ignoreSsl, username: s.username }, (res) => {
                if (res.ok) {
                    this.$root.toastSuccess(`PRTG ${res.version || "OK"}`);
                } else {
                    this.$root.toastError(res.msg);
                }
            });
        },
    },
};
</script>
