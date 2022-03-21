const redis = require('redis');
let client;

if (process.env.REDISCLOUD_URL) {
  console.log('remote redis ===> ', process.env.REDISCLOUD_URL);
  client = redis.createClient({
    url: process.env.REDISCLOUD_URL,
  }, {no_ready_check: true});
} else {
  client = redis.createClient();
}

exports.initRedis = async () => {
  client.on('error', (err) => console.log('Redis Client Error', err));
  await client.connect();
  client.on('connect', () => console.log('client connected successfully'));
};

exports.redisClient = client;