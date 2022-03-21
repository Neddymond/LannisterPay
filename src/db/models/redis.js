const config = require('../../config/config');
const redis = require('redis');
let client = redis.createClient();;

exports.initRedis = async () => {
  client.on('error', (err) => console.log('Redis Client Error', err));
  await client.connect();
  client.on('connect', () => console.log('client connected successfully'));

  // await client.hSet("car", "car.name", "Toyota");
  // await client.hSet("car", "colour", "Red");
  // await client.hSet("car", "owner", "Chinedu");
  // await client.hSet("car", "key", "Custom");
  // await client.hSet("car", "car.model", "Latest");
  // const value = await client.hGetAll("car");
  // console.log('redis keyyyy ====> ', value);
};

exports.redisClient = client;