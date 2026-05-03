exports.up = async function (knex) {
    await knex.schema.createTable("prtg_server", function (table) {
        table.increments("id");
        table.string("name", 150).notNullable();
        table.string("url", 500).notNullable();
        table.string("username", 255).nullable();
        table.string("passhash", 500).nullable();
        table.string("api_token", 500).nullable();
        table.boolean("use_api_token").notNullable().defaultTo(false);
        table.boolean("ignore_ssl").notNullable().defaultTo(false);
        table.timestamp("created_date").defaultTo(knex.fn.now());
    });

    await knex.schema.alterTable("monitor", function (table) {
        table.integer("prtg_server_id").unsigned().nullable();
        table.integer("prtg_sensor_id").nullable();
        table.string("prtg_device", 255).nullable();
    });

    await knex.schema.alterTable("heartbeat", function (table) {
        table.text("channels", "longtext").nullable();
    });
};

exports.down = async function (knex) {
    await knex.schema.alterTable("heartbeat", function (table) {
        table.dropColumn("channels");
    });
    await knex.schema.alterTable("monitor", function (table) {
        table.dropColumn("prtg_server_id");
        table.dropColumn("prtg_sensor_id");
        table.dropColumn("prtg_device");
    });
    await knex.schema.dropTable("prtg_server");
};
