const sql = require("mysql2");
require('dotenv').config();

const sqlconnect = sql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    multipleStatements: true
});

sqlconnect.connect((err) => {
    if(!err){
        console.log("Connected to DB");
    }
    else{
        console.log(err);
    }
});

module.exports = sqlconnect;