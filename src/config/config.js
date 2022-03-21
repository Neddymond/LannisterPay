module.exports = {
  port: process.env.PORT || 2002,
  db: {
    mongo: {
      db_name: process.env.DB_NAME,
      db_url: `mongodb+srv://${process.env.DB_USERNAME}:${process.env.DB_PASSWORD}@${process.env.DB_HOST}/${process.env.DB_NAME}?retryWrites=true&w=majority`
    },
    redis: {
      REDIS_DB: process.env.REDIS_DB,
      REDIS_HOST: process.env.REDIS_HOST || 'localhost',
      REDIS_PORT: process.env.REDIS_PORT || 6379,
      REDIS_PASSWORD: process.env.REDIS_PASSWORD || 'secret'
    }
  }
}