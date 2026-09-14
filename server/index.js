const keys = require('./keys');

// Express App Setup
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Postgres Client Setup
const { Pool } = require('pg');
const pgClient = new Pool({
  user: keys.pgUser,
  host: keys.pgHost,
  database: keys.pgDatabase,
  password: keys.pgPassword,
  port: keys.pgPort,
  ssl:
    process.env.NODE_ENV !== 'production'
      ? false
      : { rejectUnauthorized: false },
});

pgClient.on("connect", (client) => {
  client
    .query("CREATE TABLE IF NOT EXISTS values (number INT)")
    .catch((err) => console.error(err));
});

// Redis Client Setup
const redis = require('redis');
const redisClient = redis.createClient({
  host: keys.redisHost,
  port: keys.redisPort,
  retry_strategy: () => 1000,
});
const redisPublisher = redisClient.duplicate();

// Express route handlers

app.get('/', (req, res) => {
  res.send('Hi');
});

app.get('/values/all', async (req, res) => {
  const values = await pgClient.query('SELECT * from values');

  res.send(values.rows);
});

app.get('/values/current', async (req, res) => {
  redisClient.hgetall('values', (err, values) => {
    if (err) {
      console.error('Error reading Redis values:', err);
      return res.status(500).send('Server error');
    }

    res.send(values || {});
  });
});

app.post('/values', async (req, res) => {
  try {
    const parsedIndex = parseInt(req.body.index, 10);
    if (isNaN(parsedIndex)) {
      return res.status(400).send('Index must be a valid number');
    }

    if (parsedIndex > 40) {
      return res.status(422).send('Index too high!');
    }

    redisClient.hset('values', parsedIndex.toString(), 'Nothing yet!', (redisError) => {
      if (redisError) {
        console.error('Error writing Redis value:', redisError);
        return res.status(500).send('Server error');
      }

      redisPublisher.publish('insert', parsedIndex.toString(), (publishError) => {
        if (publishError) {
          console.error('Error publishing Redis value:', publishError);
          return res.status(500).send('Server error');
        }

        pgClient.query('INSERT INTO values(number) VALUES($1)', [parsedIndex], (databaseError) => {
          if (databaseError) {
            console.error('Error saving database value:', databaseError);
            return res.status(500).send('Server error');
          }

          res.send({ working: true });
        });
      });
    });
  } catch (err) {
    console.error('Error inserting value:', err);
    res.status(500).send('Server error');
  }
});

app.listen(5000, '0.0.0.0', (err) => {
  console.log('Listening...');
});
