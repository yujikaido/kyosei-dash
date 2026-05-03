exports.up = function (knex) {
    return knex.schema.alterTable("prtg_server", function (table) {
        table.string("map_url", 1000).nullable();
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable("prtg_server", function (table) {
        table.dropColumn("map_url");
    });
};
