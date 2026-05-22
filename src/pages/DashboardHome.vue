<template>
    <transition ref="tableContainer" name="slide-fade" appear>
        <div v-if="$route.name === 'DashboardHome'">
            <!-- Kyosei Dash — segmented button group (matches List/Devices toggle).
                 Bootstrap nav-tabs don't honor dark mode well, so using btn-group instead. -->
            <div class="btn-group mb-3" role="group" aria-label="Dashboard view">
                <button
                    type="button"
                    class="btn"
                    :class="dashTab === 'stats' ? 'btn-primary' : 'btn-outline-secondary'"
                    @click="dashTab = 'stats'"
                >
                    <font-awesome-icon icon="heartbeat" /> {{ $t("Quick Stats") }}
                </button>
                <button
                    type="button"
                    class="btn"
                    :class="dashTab === 'pinned' ? 'btn-primary' : 'btn-outline-secondary'"
                    @click="dashTab = 'pinned'"
                >
                    <font-awesome-icon icon="thumbtack" /> Traffic Monitors
                    <span class="badge bg-light text-dark ms-1">{{ pinnedMonitors.length }}</span>
                </button>
            </div>

            <div v-show="dashTab === 'stats'" class="shadow-box big-padding text-center mb-3">
                <div class="row">
                    <div class="col">
                        <h3>{{ $t("Up") }}</h3>
                        <span class="num" :class="$root.stats.up === 0 && 'text-secondary'">
                            {{ $root.stats.up }}
                        </span>
                    </div>
                    <div class="col">
                        <h3>{{ $t("Down") }}</h3>
                        <span class="num" :class="$root.stats.down > 0 ? 'text-danger' : 'text-secondary'">
                            {{ $root.stats.down }}
                        </span>
                    </div>
                    <div class="col">
                        <h3>{{ $t("Maintenance") }}</h3>
                        <span class="num" :class="$root.stats.maintenance > 0 ? 'text-maintenance' : 'text-secondary'">
                            {{ $root.stats.maintenance }}
                        </span>
                    </div>
                    <div class="col">
                        <h3>{{ $t("Unknown") }}</h3>
                        <span class="num text-secondary">{{ $root.stats.unknown }}</span>
                    </div>
                    <div class="col">
                        <h3>{{ $t("pauseDashboardHome") }}</h3>
                        <span class="num text-secondary">{{ $root.stats.pause }}</span>
                    </div>
                </div>
            </div>

            <div v-show="dashTab === 'pinned'" class="mb-3">
                <p v-if="!pinnedMonitors.length" class="shadow-box big-padding text-center text-muted">
                    Nothing pinned yet. Open a monitor's detail page and click <strong>📌 Pin to dashboard</strong> to add it here. 2×2 grid recommended (4 monitors).
                </p>
                <div v-else class="row g-3">
                    <div
                        v-for="m in pinnedMonitors"
                        :key="m.id"
                        class="col-12 col-md-6"
                    >
                        <div class="shadow-box p-3">
                            <div class="d-flex align-items-center mb-2">
                                <router-link :to="`/dashboard/${m.id}`" class="fw-bold text-decoration-none">
                                    {{ m.name }}
                                </router-link>
                                <span v-if="m.prtg_device" class="text-muted small ms-2">{{ m.prtg_device }}</span>
                                <span class="ms-auto d-flex gap-2 align-items-center">
                                    <span class="badge" :class="lastStatusBadge(m)">{{ lastStatusLabel(m) }}</span>
                                    <button
                                        class="btn btn-sm btn-outline-secondary"
                                        title="Expand to full-size view"
                                        @click="openExpanded(m)"
                                    >
                                        <font-awesome-icon icon="expand" />
                                    </button>
                                </span>
                            </div>
                            <ChannelsChart :monitor-id="m.id" :zoomable="false" />
                        </div>
                    </div>
                </div>
            </div>

            <!-- Kyosei Dash — expanded chart modal (used by Traffic Monitors panel) -->
            <div ref="expandedEl" class="modal fade" tabindex="-1" aria-hidden="true">
                <div class="modal-dialog modal-xl modal-dialog-centered">
                    <div class="modal-content">
                        <div class="modal-header">
                            <h5 class="modal-title">
                                <span v-if="expandedMonitor">
                                    {{ expandedMonitor.name }}
                                    <span v-if="expandedMonitor.prtg_device" class="text-muted small ms-2">{{ expandedMonitor.prtg_device }}</span>
                                </span>
                            </h5>
                            <button type="button" class="btn-close" data-bs-dismiss="modal" aria-label="Close"></button>
                        </div>
                        <div class="modal-body">
                            <div v-if="expandedMonitor" class="expanded-chart">
                                <ChannelsChart :key="`exp-${expandedMonitor.id}-${expandedKey}`" :monitor-id="expandedMonitor.id" :zoomable="true" />
                            </div>
                        </div>
                        <div class="modal-footer">
                            <router-link
                                v-if="expandedMonitor"
                                :to="`/dashboard/${expandedMonitor.id}`"
                                class="btn btn-outline-secondary"
                                @click="expandedInstance && expandedInstance.hide()"
                            >
                                Open full detail page
                            </router-link>
                            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
                        </div>
                    </div>
                </div>
            </div>

            <div class="shadow-box table-shadow-box table-wrapper">
                <div class="mb-3 text-end">
                    <button
                        class="btn btn-sm btn-outline-danger"
                        :disabled="clearingAllEvents"
                        @click="clearAllEventsDialog"
                    >
                        {{ $t("Clear All Events") }}
                    </button>
                </div>
                <table class="table table-borderless table-hover">
                    <thead>
                        <tr>
                            <th v-if="showGroupColumn">{{ $t("Group Name") }}</th>
                            <th class="name-column">{{ $t("Name") }}</th>
                            <th>{{ $t("Status") }}</th>
                            <th>{{ $t("DateTime") }}</th>
                            <th>{{ $t("Message") }}</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="(beat, index) in displayedRecords"
                            :key="index"
                            :class="{ 'shadow-box': $root.windowWidth <= 550 }"
                        >
                            <td v-if="showGroupColumn">
                                <router-link
                                    v-if="getGroupName(beat.monitorID)"
                                    :to="`/dashboard/${getGroupId(beat.monitorID)}`"
                                >
                                    {{ getGroupName(beat.monitorID) }}
                                </router-link>
                                <span v-else class="text-secondary">—</span>
                            </td>
                            <td class="name-column">
                                <router-link :to="`/dashboard/${beat.monitorID}`">
                                    {{ $root.monitorList[beat.monitorID]?.name }}
                                </router-link>
                            </td>
                            <td><Status :status="beat.status" /></td>
                            <td :class="{ 'border-0': !beat.msg }"><Datetime :value="beat.time" /></td>
                            <td class="border-0">{{ beat.msg }}</td>
                        </tr>

                        <tr v-if="importantHeartBeatListLength === 0">
                            <td :colspan="tableColumnCount">
                                {{ $t("No important events") }}
                            </td>
                        </tr>
                    </tbody>
                </table>

                <div class="d-flex justify-content-center kuma_pagination">
                    <pagination
                        v-model="page"
                        :records="importantHeartBeatListLength"
                        :per-page="perPage"
                        :options="paginationConfig"
                    />
                </div>
            </div>
        </div>
    </transition>
    <Confirm
        ref="confirmClearEvents"
        btn-style="btn-danger"
        :yes-text="$t('Yes')"
        :no-text="$t('No')"
        @yes="clearAllEvents"
    >
        {{ $t("clearAllEventsMsg") }}
    </Confirm>
    <router-view ref="child" />
</template>

<script>
import Status from "../components/Status.vue";
import Datetime from "../components/Datetime.vue";
import Pagination from "v-pagination-3";
import Confirm from "../components/Confirm.vue";
import ChannelsChart from "../components/ChannelsChart.vue";
import { Modal } from "bootstrap";

export default {
    components: {
        Datetime,
        Status,
        Pagination,
        Confirm,
        ChannelsChart,
    },
    props: {
        calculatedHeight: {
            type: Number,
            default: 0,
        },
    },
    data() {
        return {
            page: 1,
            perPage: 25,
            initialPerPage: 25,
            paginationConfig: {
                hideCount: true,
                chunksNavigation: "scroll",
            },
            importantHeartBeatListLength: 0,
            displayedRecords: [],
            clearingAllEvents: false,
            // Kyosei Dash — dashboard tab strip
            dashTab: localStorage.getItem("kyoseiDashTab") || "stats",
            expandedMonitor: null,
            expandedInstance: null,
            expandedKey: 0,
        };
    },
    watch: {
        dashTab(v) { localStorage.setItem("kyoseiDashTab", v); },
    },
    computed: {
        /** Kyosei Dash — monitors flagged pinned_to_dashboard, sorted by name */
        pinnedMonitors() {
            return Object.values(this.$root.monitorList || {})
                .filter((m) => m.pinned_to_dashboard)
                .sort((a, b) => a.name.localeCompare(b.name));
        },
        showGroupColumn() {
            return Object.values(this.$root.monitorList).some((m) => m.parent != null);
        },
        tableColumnCount() {
            return this.showGroupColumn ? 5 : 4;
        },
    },
    watch: {
        perPage() {
            this.$nextTick(() => {
                this.getImportantHeartbeatListPaged();
            });
        },

        page() {
            this.getImportantHeartbeatListPaged();
        },
    },

    mounted() {
        this.getImportantHeartbeatListLength();

        this.$root.emitter.on("newImportantHeartbeat", this.onNewImportantHeartbeat);

        this.initialPerPage = this.perPage;

        window.addEventListener("resize", this.updatePerPage);
        this.updatePerPage();
    },

    beforeUnmount() {
        this.$root.emitter.off("newImportantHeartbeat", this.onNewImportantHeartbeat);

        window.removeEventListener("resize", this.updatePerPage);
    },

    methods: {
        /**
         * Kyosei Dash — open the larger chart modal for a pinned monitor
         * @param {object} m monitor
         * @returns {void}
         */
        openExpanded(m) {
            this.expandedMonitor = m;
            this.expandedKey++;   // force ChannelsChart remount so it pulls fresh data
            if (!this.expandedInstance) {
                this.expandedInstance = new Modal(this.$refs.expandedEl);
            }
            this.expandedInstance.show();
        },
        /**
         * Kyosei Dash — last status badge class for pinned panel
         * @param {object} m monitor
         * @returns {string} bootstrap class
         */
        lastStatusBadge(m) {
            const hb = this.$root.lastHeartbeatList && this.$root.lastHeartbeatList[m.id];
            if (!hb) return "bg-secondary";
            return hb.status === 1 ? "bg-success" : hb.status === 0 ? "bg-danger" : "bg-secondary";
        },
        lastStatusLabel(m) {
            const hb = this.$root.lastHeartbeatList && this.$root.lastHeartbeatList[m.id];
            if (!hb) return "—";
            return hb.status === 1 ? "Up" : hb.status === 0 ? "Down" : "Pending";
        },
        /**
         * Returns the group (parent) name for a monitor, or empty string if none.
         * @param {number} monitorID - The monitor ID.
         * @returns {string} The group name or empty string.
         */
        getGroupName(monitorID) {
            const monitor = this.$root.monitorList[monitorID];
            if (!monitor || monitor.parent == null) {
                return "";
            }
            const parent = this.$root.monitorList[monitor.parent];
            return parent ? parent.name : "";
        },

        /**
         * Returns the group (parent) ID for a monitor, or null if none.
         * @param {number} monitorID - The monitor ID.
         * @returns {number|null} The group monitor ID or null.
         */
        getGroupId(monitorID) {
            const monitor = this.$root.monitorList[monitorID];
            return monitor && monitor.parent != null ? monitor.parent : null;
        },

        /**
         * Updates the displayed records when a new important heartbeat arrives.
         * @param {object} heartbeat - The heartbeat object received.
         * @returns {void}
         */
        onNewImportantHeartbeat(heartbeat) {
            if (this.page === 1) {
                this.displayedRecords.unshift(heartbeat);
                if (this.displayedRecords.length > this.perPage) {
                    this.displayedRecords.pop();
                }
                this.importantHeartBeatListLength += 1;
            }
        },

        /**
         * Retrieves the length of the important heartbeat list for all monitors.
         * @returns {void}
         */
        getImportantHeartbeatListLength() {
            this.$root.getSocket().emit("monitorImportantHeartbeatListCount", null, (res) => {
                if (res.ok) {
                    this.importantHeartBeatListLength = res.count;
                    this.getImportantHeartbeatListPaged();
                }
            });
        },

        /**
         * Retrieves the important heartbeat list for the current page.
         * @returns {void}
         */
        getImportantHeartbeatListPaged() {
            const offset = (this.page - 1) * this.perPage;
            this.$root.getSocket().emit("monitorImportantHeartbeatListPaged", null, offset, this.perPage, (res) => {
                if (res.ok) {
                    this.displayedRecords = res.data;
                }
            });
        },

        /**
         * Updates the number of items shown per page based on the available height.
         * @returns {void}
         */
        updatePerPage() {
            const tableContainer = this.$refs.tableContainer;
            const tableContainerHeight = tableContainer.offsetHeight;
            const availableHeight = window.innerHeight - tableContainerHeight;
            const additionalPerPage = Math.floor(availableHeight / 58);

            if (additionalPerPage > 0) {
                this.perPage = Math.max(this.initialPerPage, this.perPage + additionalPerPage);
            } else {
                this.perPage = this.initialPerPage;
            }
        },

        clearAllEventsDialog() {
            this.$refs.confirmClearEvents.show();
        },
        clearAllEvents() {
            this.clearingAllEvents = true;
            const monitorIDs = Object.keys(this.$root.monitorList);
            let failed = 0;
            const total = monitorIDs.length;

            if (total === 0) {
                this.clearingAllEvents = false;
                this.$root.toastError(this.$t("No monitors found"));
                return;
            }

            monitorIDs.forEach((monitorID) => {
                this.$root.getSocket().emit("clearEvents", monitorID, (res) => {
                    if (!res || !res.ok) {
                        failed++;
                    }
                });
            });
            this.clearingAllEvents = false;
            this.page = 1;
            this.getImportantHeartbeatListLength();
            if (failed === 0) {
                this.$root.toastSuccess(this.$t("Events cleared successfully"));
            } else {
                this.$root.toastError(
                    this.$t("Could not clear events", {
                        failed,
                        total,
                    })
                );
            }
        },
    },
};
</script>

<style lang="scss" scoped>
.expanded-chart :deep(canvas) {
    height: 60vh !important;
    max-height: 70vh;
}

/* Kyosei Dash — slim down chart canvas on smaller cards so 2x2 grid fits
   nicely on tablet portrait (768-991px) without overlapping legends. */
@media (max-width: 991px) {
    .row > [class*="col-"] :deep(.chart-wrapper canvas),
    .row > [class*="col-"] :deep(canvas) {
        height: 220px !important;
    }
}

@import "../assets/vars";

.num {
    font-size: 30px;
    color: $primary;
    font-weight: bold;
    display: block;
}

.shadow-box {
    padding: 20px;
}

table {
    font-size: 14px;

    tr {
        transition: all ease-in-out 0.2ms;
    }

    @media (max-width: 550px) {
        table-layout: fixed;
        overflow-wrap: break-word;
    }
}

@media screen and (max-width: 1280px) {
    .name-column {
        min-width: 150px;
    }
}

@media screen and (min-aspect-ratio: 4/3) {
    .name-column {
        min-width: 200px;
    }
}

.table-wrapper {
    overflow-x: auto;
}
</style>
