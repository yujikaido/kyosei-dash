<template>
    <div class="shadow-box mb-3 p-0" :style="boxStyle">
        <div class="list-header">
            <!-- Line 1: Checkbox + Status + Tags + Search Bar -->
            <div class="filter-row">
                <div class="search-wrapper">
                    <a v-if="searchText != ''" class="search-icon" @click="clearSearchText">
                        <font-awesome-icon icon="times" />
                    </a>
                    <form @submit.prevent>
                        <input
                            v-model="searchText"
                            class="form-control search-input"
                            :placeholder="$t('Search...')"
                            :aria-label="$t('Search monitored sites')"
                            autocomplete="off"
                        />
                    </form>
                </div>

                <div class="filters-group">
                    <!-- Kyosei Dash — entering select mode no longer auto-selects everything.
                         Use Select all / Select none buttons in the action row instead. -->
                    <input
                        v-model="selectMode"
                        class="form-check-input"
                        type="checkbox"
                        :aria-label="$t('selectAllMonitorsAria')"
                    />

                    <MonitorListFilter
                        :filterState="filterState"
                        :allCollapsed="allGroupsCollapsed"
                        :hasGroups="groupMonitors.length >= 2"
                        @update-filter="updateFilter"
                        @toggle-collapse-all="toggleCollapseAll"
                    />
                </div>
            </div>

            <!-- Line 2: Cancel + Select all/none + Actions — visible whenever selection mode is on -->
            <div v-if="selectMode" class="selection-row">
                <button class="btn btn-outline-normal" @click="cancelSelectMode">
                    {{ $t("Cancel") }}
                </button>
                <button class="btn btn-outline-normal" @click="kyoseiSelectAll">
                    Select all
                </button>
                <button class="btn btn-outline-normal" @click="kyoseiSelectNone" :disabled="selectedMonitorCount === 0">
                    Select none
                </button>
                <span class="text-muted small ms-2">{{ selectedMonitorCount }} selected</span>
                <div class="actions-wrapper" :class="{ 'opacity-50': selectedMonitorCount === 0 }">
                    <div class="dropdown">
                        <button
                            class="btn btn-outline-normal dropdown-toggle"
                            type="button"
                            data-bs-toggle="dropdown"
                            :aria-label="$t('Actions')"
                            :disabled="bulkActionInProgress"
                            aria-expanded="false"
                        >
                            {{ $t("Actions") }}
                        </button>
                        <ul class="dropdown-menu">
                            <li>
                                <a class="dropdown-item" href="#" @click.prevent="pauseDialog">
                                    <font-awesome-icon icon="pause" class="me-2" />
                                    {{ $t("Pause") }}
                                </a>
                            </li>
                            <li>
                                <a class="dropdown-item" href="#" @click.prevent="resumeSelected">
                                    <font-awesome-icon icon="play" class="me-2" />
                                    {{ $t("Resume") }}
                                </a>
                            </li>
                            <li><hr class="dropdown-divider" /></li>
                            <li>
                                <a class="dropdown-item" href="#" @click.prevent="moveToGroup">
                                    <font-awesome-icon icon="folder" class="me-2" />
                                    Move to group…
                                </a>
                            </li>
                            <li>
                                <a class="dropdown-item" href="#" @click.prevent="groupByDevice">
                                    <font-awesome-icon icon="folder-open" class="me-2" />
                                    Group by device under…
                                </a>
                            </li>
                            <li>
                                <a class="dropdown-item" href="#" @click.prevent="setDevice">
                                    <font-awesome-icon icon="server" class="me-2" />
                                    Set device…
                                </a>
                            </li>
                            <li>
                                <a class="dropdown-item" href="#" @click.prevent="openLauncherDialog">
                                    <font-awesome-icon icon="link" class="me-2" />
                                    Add connection launcher…
                                </a>
                            </li>
                            <li><hr class="dropdown-divider" /></li>
                            <li>
                                <a
                                    class="dropdown-item text-danger"
                                    href="#"
                                    @click.prevent="$refs.confirmDelete.show()"
                                >
                                    <font-awesome-icon icon="trash" class="me-2" />
                                    {{ $t("Delete") }}
                                </a>
                            </li>
                        </ul>
                    </div>
                </div>
                <span class="selected-count">
                    {{ $t("selectedMonitorCountMsg", selectedMonitorCount) }}
                </span>
            </div>
        </div>
        <div
            ref="monitorList"
            class="monitor-list px-2"
            :class="{ scrollbar: scrollbar }"
            :style="monitorListStyle"
            data-testid="monitor-list"
        >
            <div v-if="Object.keys($root.monitorList).length === 0" class="text-center mt-3">
                {{ $t("No Monitors, please") }}
                <router-link to="/add">{{ $t("add one") }}</router-link>
            </div>

            <!-- Kyosei Dash — layout toggle -->
            <div class="d-flex justify-content-end mb-2 px-1">
                <div class="btn-group btn-group-sm" role="group">
                    <button type="button" class="btn" :class="viewMode === 'list' ? 'btn-primary' : 'btn-outline-secondary'" @click="viewMode = 'list'">
                        <font-awesome-icon icon="list" /> List
                    </button>
                    <button type="button" class="btn" :class="viewMode === 'devices' ? 'btn-primary' : 'btn-outline-secondary'" @click="viewMode = 'devices'">
                        <font-awesome-icon icon="server" /> Devices
                    </button>
                </div>
            </div>

            <template v-if="viewMode === 'list'">
                <MonitorListItem
                    v-for="item in sortedMonitorList"
                    :key="`${item.id}-${collapseKey}`"
                    :monitor="item"
                    :isSelectMode="selectMode"
                    :isSelected="isSelected"
                    :select="select"
                    :deselect="deselect"
                    :filter-func="filterFunc"
                    :sort-func="sortFunc"
                />
            </template>

            <template v-else>
                <div v-for="[device, list] in devicesGroups" :key="device" class="device-group mb-3">
                    <div class="device-header d-flex align-items-center gap-2 px-2 py-1">
                        <strong>{{ device || "Ungrouped" }}</strong>
                        <span class="text-muted small">{{ list.length }} {{ list.length === 1 ? "monitor" : "monitors" }}</span>
                        <span class="ms-auto">
                            <span class="badge bg-success me-1">{{ list.filter(m => lastStatus(m) === 1).length }} ↑</span>
                            <span class="badge bg-danger">{{ list.filter(m => lastStatus(m) === 0).length }} ↓</span>
                        </span>
                    </div>
                    <MonitorListItem
                        v-for="item in list"
                        :key="`${item.id}-${collapseKey}-dev`"
                        :monitor="item"
                        :isSelectMode="selectMode"
                        :isSelected="isSelected"
                        :select="select"
                        :deselect="deselect"
                        :filter-func="filterFunc"
                        :sort-func="sortFunc"
                    />
                </div>
            </template>
        </div>
    </div>

    <!-- Kyosei Dash — bulk-add connection launcher modal -->
    <div ref="launcherEl" class="modal fade" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">Add connection launcher to {{ launcherCount }} monitor(s)</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <p class="text-muted small mb-3">
                        <code>{host}</code> in any field is replaced per-monitor with that monitor's hostname (or the hostname parsed from its URL for HTTP monitors).
                    </p>
                    <label class="form-label">Type</label>
                    <select v-model="launcherTemplate.type" class="form-select mb-3" @change="applyPreset">
                        <option value="rdp">RDP</option>
                        <option value="ssh">SSH</option>
                        <option value="web">Web (HTTP/HTTPS)</option>
                        <option value="custom">Custom URL</option>
                    </select>
                    <label class="form-label">Label</label>
                    <input v-model="launcherTemplate.label" type="text" class="form-control mb-3" placeholder="e.g. Web Admin, Proxmox UI" />
                    <template v-if="launcherTemplate.type === 'web' || launcherTemplate.type === 'custom'">
                        <label class="form-label">URL template</label>
                        <input v-model="launcherTemplate.url" type="text" class="form-control" placeholder="https://{host}:8006" />
                        <p class="form-text">Examples: <code>https://{host}:8006</code> (Proxmox), <code>http://{host}/admin</code> (printer admin), <code>https://{host}/ui</code></p>
                    </template>
                    <template v-else>
                        <label class="form-label">Host (use <code>{host}</code> for per-monitor hostname)</label>
                        <input v-model="launcherTemplate.host" type="text" class="form-control mb-3" placeholder="{host}" />
                        <label class="form-label">Port</label>
                        <input v-model.number="launcherTemplate.port" type="number" class="form-control" />
                        <template v-if="launcherTemplate.type === 'ssh'">
                            <label class="form-label mt-3">User (optional)</label>
                            <input v-model="launcherTemplate.user" type="text" class="form-control" placeholder="root" />
                        </template>
                    </template>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                    <button type="button" class="btn btn-primary" :disabled="bulkActionInProgress" @click="confirmAddLauncher">
                        Add launcher
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- Kyosei Dash — group picker modal (replaces prompt() based action) -->
    <div ref="groupPickerEl" class="modal fade" tabindex="-1">
        <div class="modal-dialog">
            <div class="modal-content">
                <div class="modal-header">
                    <h5 class="modal-title">{{ groupPickerMode === "move" ? "Move to group" : "Group by device under…" }}</h5>
                    <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                </div>
                <div class="modal-body">
                    <p v-if="groupPickerMode === 'move'" class="mb-3">
                        Move <strong>{{ groupPickerCount }}</strong> selected monitor(s) under which group?
                    </p>
                    <p v-else class="mb-3">
                        Auto-create one sub-group per device value, place
                        <strong>{{ groupPickerCount }}</strong> selected sensor(s) under them.
                        Choose the parent group these device sub-groups will live under:
                    </p>
                    <label class="form-label">Group</label>
                    <select v-model.number="groupPickerSelection" class="form-select">
                        <option v-if="groupPickerMode === 'group'" :value="null">— Top-level (no parent) —</option>
                        <option v-if="groupPickerMode === 'move'" :value="null" disabled>— Select a group —</option>
                        <option v-for="g in availableGroups" :key="g.id" :value="g.id">
                            {{ g.name }}
                        </option>
                    </select>
                    <p v-if="!availableGroups.length" class="text-muted small mt-2 mb-0">
                        No groups exist yet — create a monitor with type "Group" first.
                    </p>
                </div>
                <div class="modal-footer">
                    <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                    <button
                        type="button"
                        class="btn btn-primary"
                        :disabled="bulkActionInProgress || (groupPickerMode === 'move' && !groupPickerSelection)"
                        @click="confirmGroupPicker"
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    </div>

    <Confirm ref="confirmPause" :yes-text="$t('Yes')" :no-text="$t('No')" @yes="pauseSelected">
        {{ $t("pauseMonitorMsg") }}
    </Confirm>

    <Confirm ref="confirmDelete" btn-style="btn-danger" :yes-text="$t('Yes')" :no-text="$t('No')" @yes="deleteSelected">
        {{ $t("deleteMonitorsMsg") }}
    </Confirm>
</template>

<script>
import Confirm from "../components/Confirm.vue";
import MonitorListItem from "../components/MonitorListItem.vue";
import MonitorListFilter from "./MonitorListFilter.vue";
import { getMonitorRelativeURL } from "../util.ts";
import { Modal } from "bootstrap";

export default {
    components: {
        Confirm,
        MonitorListItem,
        MonitorListFilter,
    },
    props: {
        /** Should the scrollbar be shown */
        scrollbar: {
            type: Boolean,
        },
    },
    data() {
        return {
            searchText: "",
            selectMode: false,
            selectAll: false,
            disableSelectAllWatcher: false,
            selectedMonitors: {},
            windowTop: 0,
            bulkActionInProgress: false,
            filterState: {
                status: null,
                active: null,
                tags: null,
            },
            collapseKey: 0,
            viewMode: localStorage.getItem("kyoseiViewMode") || "list",
            groupPickerMode: "move",            // "move" or "group"
            groupPickerSelection: null,
            groupPickerCount: 0,
            groupPickerInstance: null,
            availableGroups: [],
            launcherInstance: null,
            launcherCount: 0,
            launcherTemplate: { type: "rdp", host: "{host}", port: 3389, label: "RDP" },
        };
    },
    watch: {
        viewMode(v) { localStorage.setItem("kyoseiViewMode", v); },
    },
    computed: {
        /**
         * Improve the sticky appearance of the list by increasing its
         * height as user scrolls down.
         * Not used on mobile.
         * @returns {object} Style for monitor list
         */
        boxStyle() {
            if (window.innerWidth > 550) {
                return {
                    height: `calc(100vh - 160px + ${this.windowTop}px)`,
                };
            } else {
                return {
                    height: "calc(100vh - 160px)",
                };
            }
        },

        /**
         * Returns a sorted list of monitors based on the applied filters and search text.
         * @returns {Array} The sorted list of monitors.
         */
        /** Kyosei Dash — [device, monitors[]] pairs sorted by device name */
        devicesGroups() {
            const groups = new Map();
            for (const m of this.sortedMonitorList) {
                const key = (m.prtg_device || "").trim();
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key).push(m);
            }
            return [ ...groups.entries() ].sort((a, b) => {
                if (!a[0]) return 1;
                if (!b[0]) return -1;
                return a[0].localeCompare(b[0]);
            });
        },
        sortedMonitorList() {
            let result = Object.values(this.$root.monitorList);

            result = result.filter((monitor) => {
                // The root list does not show children
                if (monitor.parent !== null) {
                    return false;
                }
                return true;
            });

            result = result.filter(this.filterFunc);

            result.sort(this.sortFunc);

            return result;
        },

        isDarkTheme() {
            return document.body.classList.contains("dark");
        },

        monitorListStyle() {
            // The header height has to be changed in case it is modified in the future.
            // +10px is the margin-bottom of the header
            let listHeaderHeight = 58 + 10;

            // Only add extra height when selection row is visible
            if (this.selectMode && this.selectedMonitorCount > 0) {
                listHeaderHeight += 42;
            }

            return {
                height: `calc(100% - ${listHeaderHeight}px)`,
            };
        },

        selectedMonitorCount() {
            return Object.keys(this.selectedMonitors).length;
        },

        /**
         * Determines if any filters are active.
         * @returns {boolean} True if any filter is active, false otherwise.
         */
        filtersActive() {
            return (
                this.filterState.status != null ||
                this.filterState.active != null ||
                this.filterState.tags != null ||
                this.searchText !== ""
            );
        },

        /**
         * Gets all group monitors that have children at any nesting level
         * @returns {Array} Array of group monitors with children
         */
        groupMonitors() {
            const monitors = Object.values(this.$root.monitorList);
            return monitors.filter((m) => m.type === "group" && monitors.some((child) => child.parent === m.id));
        },

        /**
         * Determines if all groups are collapsed.
         * Note: collapseKey is included to force re-computation when toggleCollapseAll()
         * updates localStorage, since Vue cannot detect localStorage changes.
         * @returns {boolean} True if all groups are collapsed
         */
        allGroupsCollapsed() {
            // collapseKey forces this computed to re-evaluate after localStorage updates
            if (this.collapseKey < 0 || this.groupMonitors.length === 0) {
                return true;
            }

            const storage = window.localStorage.getItem("monitorCollapsed");
            if (storage === null) {
                return true; // Default is collapsed
            }

            const storageObject = JSON.parse(storage);
            return this.groupMonitors.every((group) => storageObject[`monitor_${group.id}`] !== false);
        },
    },
    watch: {
        searchText() {
            for (let monitor of this.sortedMonitorList) {
                if (!this.selectedMonitors[monitor.id]) {
                    if (this.selectAll) {
                        this.disableSelectAllWatcher = true;
                        this.selectAll = false;
                    }
                    break;
                }
            }
        },
        selectAll() {
            if (!this.disableSelectAllWatcher) {
                this.selectedMonitors = {};

                if (this.selectAll) {
                    this.sortedMonitorList.forEach((item) => {
                        this.selectedMonitors[item.id] = true;
                    });
                } else {
                    // Exit select mode when unchecking "select all"
                    this.selectMode = false;
                }
            } else {
                this.disableSelectAllWatcher = false;
            }
        },
        selectMode() {
            if (!this.selectMode) {
                this.selectAll = false;
                this.selectedMonitors = {};
            }
        },
    },
    mounted() {
        window.addEventListener("scroll", this.onScroll);
    },
    beforeUnmount() {
        window.removeEventListener("scroll", this.onScroll);
    },
    methods: {
        /**
         * Handle user scroll
         * @returns {void}
         */
        onScroll() {
            if (window.top.scrollY <= 133) {
                this.windowTop = window.top.scrollY;
            } else {
                this.windowTop = 133;
            }
        },
        /**
         * Get URL of monitor
         * @param {number} id ID of monitor
         * @returns {string} Relative URL of monitor
         */
        monitorURL(id) {
            return getMonitorRelativeURL(id);
        },
        /**
         * Clear the search bar
         * @returns {void}
         */
        clearSearchText() {
            this.searchText = "";
        },
        /**
         * Update the MonitorList Filter
         * @param {object} newFilter Object with new filter
         * @returns {void}
         */
        updateFilter(newFilter) {
            this.filterState = newFilter;
        },
        /**
         * Toggle collapse state for all group monitors
         * If collapsing all groups while viewing a nested group, navigate to its root parent
         * @returns {void}
         */
        toggleCollapseAll() {
            const shouldCollapse = !this.allGroupsCollapsed;

            let storageObject = {};
            const storage = window.localStorage.getItem("monitorCollapsed");
            if (storage !== null) {
                storageObject = JSON.parse(storage);
            }

            this.groupMonitors.forEach((group) => {
                storageObject[`monitor_${group.id}`] = shouldCollapse;
            });

            window.localStorage.setItem("monitorCollapsed", JSON.stringify(storageObject));

            // If collapsing all and currently viewing a nested group, navigate to root parent
            if (shouldCollapse) {
                const currentMonitorId = parseInt(this.$route.params.id);
                const currentMonitor = this.$root.monitorList[currentMonitorId];

                if (currentMonitor && currentMonitor.parent !== null) {
                    // Find the root parent by traversing up the hierarchy
                    let rootParentId = currentMonitor.parent;
                    let rootParent = this.$root.monitorList[rootParentId];

                    while (rootParent && rootParent.parent !== null) {
                        rootParentId = rootParent.parent;
                        rootParent = this.$root.monitorList[rootParentId];
                    }

                    // Navigate to the root parent, then increment collapseKey to force re-render
                    this.$router.push(getMonitorRelativeURL(rootParentId)).finally(() => {
                        this.collapseKey++;
                    });
                    return;
                }
            }

            this.collapseKey++;
        },
        /**
         * Deselect a monitor
         * @param {number} id ID of monitor
         * @returns {void}
         */
        deselect(id) {
            delete this.selectedMonitors[id];
        },
        /**
         * Select a monitor
         * @param {number} id ID of monitor
         * @returns {void}
         */
        select(id) {
            this.selectedMonitors[id] = true;
        },
        /**
         * Kyosei Dash — quick last-status lookup for device rollup
         * @param {object} m monitor
         * @returns {number} status (1 up, 0 down, -1 unknown)
         */
        lastStatus(m) {
            const hb = this.$root.lastHeartbeatList && this.$root.lastHeartbeatList[m.id];
            return hb ? hb.status : -1;
        },
        /**
         * Determine if monitor is selected
         * @param {number} id ID of monitor
         * @returns {bool} Is the monitor selected?
         */
        isSelected(id) {
            return id in this.selectedMonitors;
        },
        /**
         * Disable select mode and reset selection
         * @returns {void}
         */
        cancelSelectMode() {
            this.selectMode = false;
            this.selectedMonitors = {};
        },
        /**
         * Kyosei Dash — explicitly select every visible monitor
         * @returns {void}
         */
        kyoseiSelectAll() {
            const fresh = {};
            for (const m of this.sortedMonitorList) {
                fresh[m.id] = true;
            }
            this.selectedMonitors = fresh;
        },
        /**
         * Kyosei Dash — clear all selected monitors but stay in select mode
         * @returns {void}
         */
        kyoseiSelectNone() {
            this.selectedMonitors = {};
        },
        /**
         * Show dialog to confirm pause
         * @returns {void}
         */
        pauseDialog() {
            this.$refs.confirmPause.show();
        },
        /**
         * Kyosei Dash — open the group picker modal. Mode "move" reparents
         * selected monitors under the chosen group; mode "group" auto-creates
         * device sub-groups under the chosen parent.
         * @param {string} mode "move" or "group"
         * @returns {void}
         */
        openGroupPicker(mode) {
            const ids = Object.keys(this.selectedMonitors);
            if (!ids.length) return;
            this.availableGroups = Object.values(this.$root.monitorList)
                .filter((m) => m.type === "group")
                .sort((a, b) => a.name.localeCompare(b.name));
            if (mode === "move" && !this.availableGroups.length) {
                this.$root.toastError("No groups exist yet. Create one with type 'Group' first.");
                return;
            }
            this.groupPickerMode = mode;
            this.groupPickerCount = ids.length;
            this.groupPickerSelection = mode === "group" ? null : (this.availableGroups[0] && this.availableGroups[0].id) || null;
            if (!this.groupPickerInstance) {
                // Lazy-init the Bootstrap modal once (Modal imported from "bootstrap")
                this.groupPickerInstance = new Modal(this.$refs.groupPickerEl);
            }
            this.groupPickerInstance.show();
        },
        moveToGroup() { this.openGroupPicker("move"); },
        groupByDevice() { this.openGroupPicker("group"); },
        /**
         * Kyosei Dash — open the bulk-add-launcher modal
         * @returns {void}
         */
        openLauncherDialog() {
            const ids = Object.keys(this.selectedMonitors);
            if (!ids.length) return;
            this.launcherCount = ids.length;
            this.launcherTemplate = { type: "rdp", host: "{host}", port: 3389, label: "RDP" };
            if (!this.launcherInstance) {
                this.launcherInstance = new Modal(this.$refs.launcherEl);
            }
            this.launcherInstance.show();
        },
        applyPreset() {
            const t = this.launcherTemplate.type;
            const presets = {
                rdp: { type: "rdp", host: "{host}", port: 3389, label: "RDP" },
                ssh: { type: "ssh", host: "{host}", port: 22, user: "root", label: "SSH" },
                web: { type: "web", url: "https://{host}", label: "Web" },
                custom: { type: "custom", url: "https://{host}:8006", label: "Custom" },
            };
            this.launcherTemplate = presets[t] || presets.rdp;
        },
        confirmAddLauncher() {
            const ids = Object.keys(this.selectedMonitors);
            if (!ids.length) return;
            this.bulkActionInProgress = true;
            this.$root.getSocket().emit("kyoseiBulkAddConnection", ids, this.launcherTemplate, (res) => {
                this.bulkActionInProgress = false;
                this.launcherInstance && this.launcherInstance.hide();
                if (res && res.ok) {
                    this.$root.toastSuccess(`Added launcher to ${res.added} monitor(s).${res.skipped ? " Skipped " + res.skipped + " (no host)." : ""}`);
                    this.cancelSelectMode && this.cancelSelectMode();
                } else {
                    this.$root.toastError(res ? res.msg : "Failed");
                }
            });
        },
        /**
         * Kyosei Dash — confirm handler for the group picker modal.
         * Dispatches the right socket event based on mode.
         * @returns {void}
         */
        confirmGroupPicker() {
            const ids = Object.keys(this.selectedMonitors);
            if (!ids.length) {
                this.groupPickerInstance && this.groupPickerInstance.hide();
                return;
            }
            this.bulkActionInProgress = true;
            if (this.groupPickerMode === "move") {
                const groupId = this.groupPickerSelection;
                if (!groupId) {
                    this.bulkActionInProgress = false;
                    return;
                }
                const targetName = (this.availableGroups.find((g) => g.id === groupId) || {}).name || "group";
                this.$root.getSocket().emit("kyoseiBulkMoveToGroup", ids, groupId, (res) => {
                    this.bulkActionInProgress = false;
                    this.groupPickerInstance && this.groupPickerInstance.hide();
                    if (res && res.ok) {
                        this.$root.toastSuccess(`Moved ${res.count} monitor(s) under "${targetName}".`);
                        this.cancelSelectMode && this.cancelSelectMode();
                    } else {
                        this.$root.toastError(res ? res.msg : "Failed");
                    }
                });
            } else {
                const parentId = this.groupPickerSelection || null;
                this.$root.getSocket().emit("kyoseiBulkGroupByDevice", ids, parentId, (res) => {
                    this.bulkActionInProgress = false;
                    this.groupPickerInstance && this.groupPickerInstance.hide();
                    if (res && res.ok) {
                        this.$root.toastSuccess(
                            `Created ${res.groupsCreated} device group(s), moved ${res.monitorsMoved} sensor(s).`
                        );
                        this.cancelSelectMode && this.cancelSelectMode();
                    } else {
                        this.$root.toastError(res ? res.msg : "Failed");
                    }
                });
            }
        },
        /**
         * Kyosei Dash — bulk set the Device field on selected monitors.
         * @returns {void}
         */
        setDevice() {
            const ids = Object.keys(this.selectedMonitors);
            if (!ids.length) return;
            const device = prompt(`Set Device field on ${ids.length} monitor(s) (used for the Devices view).\n\nEnter device name (e.g. "10.1.1.16" or "core-switch"). Leave blank to clear.`);
            if (device === null) return;   // cancelled
            this.bulkActionInProgress = true;
            this.$root.getSocket().emit("kyoseiBulkSetDevice", ids, device, (res) => {
                this.bulkActionInProgress = false;
                if (res && res.ok) {
                    this.$root.toastSuccess(`Updated ${res.count} monitor(s).`);
                } else {
                    this.$root.toastError(res ? res.msg : "Failed");
                }
            });
        },
        /**
         * Pause each selected monitor
         * @returns {void}
         */
        pauseSelected() {
            if (this.bulkActionInProgress) {
                return;
            }

            const activeMonitors = Object.keys(this.selectedMonitors).filter((id) => this.$root.monitorList[id].active);

            if (activeMonitors.length === 0) {
                this.$root.toastError(this.$t("noMonitorsPausedMsg"));
                return;
            }

            this.bulkActionInProgress = true;
            activeMonitors.forEach((id) => this.$root.getSocket().emit("pauseMonitor", id, () => {}));
            this.$root.toastSuccess(this.$t("pausedMonitorsMsg", activeMonitors.length));
            this.bulkActionInProgress = false;
            this.cancelSelectMode();
        },
        /**
         * Resume each selected monitor
         * @returns {void}
         */
        resumeSelected() {
            if (this.bulkActionInProgress) {
                return;
            }

            const inactiveMonitors = Object.keys(this.selectedMonitors).filter(
                (id) => !this.$root.monitorList[id].active
            );

            if (inactiveMonitors.length === 0) {
                this.$root.toastError(this.$t("noMonitorsResumedMsg"));
                return;
            }

            this.bulkActionInProgress = true;
            inactiveMonitors.forEach((id) => this.$root.getSocket().emit("resumeMonitor", id, () => {}));
            this.$root.toastSuccess(this.$t("resumedMonitorsMsg", inactiveMonitors.length));
            this.bulkActionInProgress = false;
            this.cancelSelectMode();
        },
        /**
         * Delete each selected monitor
         * @returns {Promise<void>}
         */
        async deleteSelected() {
            if (this.bulkActionInProgress) {
                return;
            }

            const monitorIds = Object.keys(this.selectedMonitors);

            this.bulkActionInProgress = true;
            let successCount = 0;
            let errorCount = 0;

            for (const id of monitorIds) {
                try {
                    await new Promise((resolve, reject) => {
                        this.$root.getSocket().emit("deleteMonitor", id, false, (res) => {
                            if (res.ok) {
                                successCount++;
                                resolve();
                            } else {
                                errorCount++;
                                reject();
                            }
                        });
                    });
                } catch (error) {
                    // Error already counted
                }
            }

            this.bulkActionInProgress = false;

            if (successCount > 0) {
                this.$root.toastSuccess(this.$t("deletedMonitorsMsg", successCount));
            }
            if (errorCount > 0) {
                this.$root.toastError(this.$t("bulkDeleteErrorMsg", errorCount));
            }

            this.cancelSelectMode();
        },
        /**
         * Whether a monitor should be displayed based on the filters
         * @param {object} monitor Monitor to check
         * @returns {boolean} Should the monitor be displayed
         */
        filterFunc(monitor) {
            // Group monitors bypass filter if at least 1 of children matched
            if (monitor.type === "group") {
                const children = Object.values(this.$root.monitorList).filter((m) => m.parent === monitor.id);
                if (children.some((child, index, children) => this.filterFunc(child))) {
                    return true;
                }
            }

            // filter by search text
            // finds monitor name, tag name or tag value
            let searchTextMatch = true;
            if (this.searchText !== "") {
                const loweredSearchText = this.searchText.toLowerCase();
                searchTextMatch =
                    monitor.name.toLowerCase().includes(loweredSearchText) ||
                    monitor.tags.find(
                        (tag) =>
                            tag.name.toLowerCase().includes(loweredSearchText) ||
                            tag.value?.toLowerCase().includes(loweredSearchText)
                    );
            }

            // filter by status
            let statusMatch = true;
            if (this.filterState.status != null && this.filterState.status.length > 0) {
                if (monitor.id in this.$root.lastHeartbeatList && this.$root.lastHeartbeatList[monitor.id]) {
                    monitor.status = this.$root.lastHeartbeatList[monitor.id].status;
                }
                statusMatch = this.filterState.status.includes(monitor.status);
            }

            // filter by active
            let activeMatch = true;
            if (this.filterState.active != null && this.filterState.active.length > 0) {
                activeMatch = this.filterState.active.includes(monitor.active);
            }

            // filter by tags
            let tagsMatch = true;
            if (this.filterState.tags != null && this.filterState.tags.length > 0) {
                tagsMatch =
                    monitor.tags
                        .map((tag) => tag.tag_id) // convert to array of tag IDs
                        .filter((monitorTagId) => this.filterState.tags.includes(monitorTagId)).length > 0; // perform Array Intersaction between filter and monitor's tags
            }

            return searchTextMatch && statusMatch && activeMatch && tagsMatch;
        },
        /**
         * Function used in Array.sort to order monitors in a list.
         * @param {*} m1 monitor 1
         * @param {*} m2 monitor 2
         * @returns {number} -1, 0 or 1
         */
        sortFunc(m1, m2) {
            if (m1.active !== m2.active) {
                if (m1.active === false) {
                    return 1;
                }

                if (m2.active === false) {
                    return -1;
                }
            }

            if (m1.weight !== m2.weight) {
                if (m1.weight > m2.weight) {
                    return -1;
                }

                if (m1.weight < m2.weight) {
                    return 1;
                }
            }

            return m1.name.localeCompare(m2.name);
        },
    },
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.shadow-box {
    height: calc(100vh - 150px);
    position: sticky;
    top: 10px;
}

.small-padding {
    padding-left: 5px !important;
    padding-right: 5px !important;
}

.list-header {
    border-bottom: 1px solid #dee2e6;
    border-radius: 10px 10px 0 0;
    margin-bottom: 10px;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;

    .dark & {
        background-color: $dark-header-bg;
        border-bottom: 0;
    }
}

.filter-row {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    gap: 8px;
    flex-wrap: nowrap;
    width: 100%;

    .form-check-input {
        cursor: pointer;
        margin: 0;
        margin-left: 6px;
        flex-shrink: 0;
    }
}

.filters-group {
    display: flex;
    align-items: center;
    gap: 8px;
}

.actions-wrapper {
    display: flex;
    align-items: center;

    .dropdown-toggle {
        white-space: nowrap;

        &:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
    }

    .dropdown-menu {
        min-width: 140px;
        padding: 4px 0;
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);

        .dark & {
            background-color: $dark-bg;
            border-color: $dark-border-color;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
        }
    }

    .dropdown-item {
        cursor: pointer;
        padding: 6px 12px;
        font-size: 0.9em;

        .dark & {
            color: $dark-font-color;

            &:hover {
                background-color: $dark-bg2;
                color: $dark-font-color;
            }
        }

        &.text-danger {
            color: #dc3545;

            .dark & {
                color: #dc3545;
            }

            &:hover {
                background-color: #dc3545 !important;
                color: white !important;

                .dark & {
                    background-color: #dc3545 !important;
                    color: white !important;
                }

                svg {
                    color: white !important;
                }
            }
        }
    }
}

.selection-row {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
}

.selected-count {
    white-space: nowrap;
    font-size: 0.9em;
    color: $primary;

    .dark & {
        color: $dark-font-color;
    }
}

.selection-controls {
    margin-top: 5px;
    display: flex;
    align-items: center;

    .d-flex {
        width: 100%;
    }

    .gap-2 {
        gap: 0.5rem;
    }

    .selected-count {
        margin-left: auto;
    }
}

@media (max-width: 975px) {
    .filter-row {
        flex-direction: column-reverse;
        align-items: stretch;
        gap: 8px;
    }

    .search-wrapper {
        width: 100% !important;
        max-width: 100% !important;
        margin-left: 0 !important;
        flex: 1 1 100%;
    }

    .filters-group {
        width: 100%;
    }
}

@media (max-width: 770px) {
    .list-header {
        margin-bottom: 10px;
        padding: 20px;
    }
}

.search-wrapper {
    display: flex;
    align-items: center;
    position: relative;
    flex: 1 1 auto;
    min-width: 0;
    max-width: 300px;
    margin-left: auto;
    order: 1;

    form {
        width: 100%;
    }
}

.search-icon {
    position: absolute;
    right: 10px;
    color: #c0c0c0;
    cursor: pointer;
    transition: all ease-in-out 0.1s;
    z-index: 1;

    &:hover {
        opacity: 0.5;
    }
}

.search-input {
    width: 100%;
    padding-right: 30px;
    transition: none !important;
}

.tags {
    margin-top: 4px;
    padding-left: 67px;
    display: flex;
    flex-wrap: wrap;
    gap: 0;
}

@media (max-width: 549px), (min-width: 770px) and (max-width: 1149px), (min-width: 1200px) and (max-width: 1499px) {
    .selection-controls {
        .selected-count {
            margin-left: 0;
            width: 100%;
            margin-top: 0.25rem;
        }
    }
}
</style>
