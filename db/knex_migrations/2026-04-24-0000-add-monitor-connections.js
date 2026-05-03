exports.up = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.text("connections", "longtext").nullable();
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("monitor", function (table) {
        table.dropColumn("connections");
    });
};
