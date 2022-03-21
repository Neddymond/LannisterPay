const mongoose = require('mongoose'),
  config = require('../../config/config');

try {
  mongoose.connect(config.db.mongo.db_url, {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
} catch (error) {
  console.log('Mongo connection error =====> ', error);
}

mongoose.connection.on('connected', function () {
  console.log('MongoDB: connected');
});
mongoose.connection.on('error',function (err) {
  console.log('MongoDB: connection error! ', err);
});
mongoose.connection.on('disconnected', function () {
  console.log('MongoDB: disconnected!');
});

require('./Fee');