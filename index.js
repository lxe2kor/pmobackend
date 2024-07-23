const express = require("express");
const bodyParser = require("body-parser");
const cors = require("cors");
const Router = require("./routes/router");
const session = require("express-session");
require('dotenv').config();

const app = express();
app.use(cors({ origin: 'http://localhost:3000', credentials: true }));
app.use(session({
    secret: process.env.JWT_SECRET,
    resave: false,
    saveUninitialized: true,
  }));

const port = 7000;
app.use(bodyParser.json());

app.use("/api", Router);

app.listen(port, () => console.log("Running on port 7000"));