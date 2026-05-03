exports.up = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.boolean("pinned_to_dashboard").notNullable().defaultTo(false);
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.dropColumn("pinned_to_dashboard");
    });
};
