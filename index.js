const express = require('express');
const app = express();
const { urlencoded} = require('body-parser');
const config = require('./src/config/config');
const port = config.port;
console.log('port =========> ', port);
const { initRedis } = require('./src/db/models/redis');

require('./src/db/models/mongo');
initRedis();

const feeRoute = require('./src/routes/index');

app.use(express.json());

app.use(urlencoded({ extended: false }));
// app.use(json);

app.use('', feeRoute);



app.listen(port, () => console.log(`server is listening on port ${port}`));