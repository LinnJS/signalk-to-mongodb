const { MongoClient } = require('mongodb');

const settings = {
  housekeepingMillis: 30000, // time between performing regular housekeeping tasks
  responseMillis: 10000, // allow 10 seconds for the server to start sending
  deadlineMillis: 25000, // allow 25 seconds for the response to finish
  defaultTtlMillis: 60000, // time-to-live in milliseconds
};

class MongoDb {
  buffer = new Map();
  options = null;
  app = null;
  timer = null;
  flushExpiry = new Date();
  flushMillis = 0;
  ttlMillis = settings.defaultTtlMillis;
  flushing = false;
  isConnected = false; // Track connection status

  dbClient = null; // MongoDB client
  database = null; // Database name
  collection = null; // Collection name

  constructor(app, dbUri, database, collection) {
    this.app = app;
    this.dbUri = dbUri;
    this.database = database;
    this.collection = collection;
    this.dbClient = new MongoClient(dbUri);
  }

  async connect(retryCount = 5, retryDelay = 1000) {
    for (let attempt = 0; attempt <= retryCount; attempt++) {
      try {
        await this.dbClient.connect();
        this.isConnected = true;
        this.app.debug('Connected to MongoDB');
        return; // Exit if connection is successful
      } catch (err) {
        this.app.error(`Error connecting to MongoDB on attempt ${attempt}: ${err}`);
        if (attempt === retryCount) {
          this.app.error('All MongoDB connection attempts failed');
          throw err; // Rethrow the last error or handle it as needed
        }
        const delay = retryDelay * Math.pow(2, attempt);
        this.app.debug(`Waiting ${delay}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, delay)); // Wait before retrying
      }
    }
  }

  async start(options) {
    this.app.debug(`MongoDB options: ${JSON.stringify(options)}`);
    this.options = options;
    await this.connect(); // Ensure connection before proceeding
    this.ttlMillis = options.ttlSecs ? options.ttlSecs * 1000 : this.ttlMillis;
    this.flushMillis = options.flushSecs ? options.flushSecs * 1000 : this.flushMillis;
    this.flushExpiry = new Date(Date.now() + this.flushMillis);
    this.timer = setInterval(this.housekeeping.bind(this), options.housekeepingMillis);
  }

  async stop() {
    await this.flush();
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.dbClient) {
      await this.dbClient.close();
      this.isConnected = false;
      this.app.debug('MongoDB connection closed');
    }
  }

  getPoint(point) {
    try {
      point.time = point.time ? new Date(point.time) : new Date();
      point.expiry = new Date(Date.now() + this.ttlMillis);
      let json = JSON.stringify(point);
      let i = json.length;
      let hash1 = 5381;
      let hash2 = 52711;
      while (i--) {
        const c = json.charCodeAt(i);
        hash1 = (hash1 * 33) ^ c;
        hash2 = (hash2 * 33) ^ c;
      }
      point.uid = (hash1 >>> 0) * 4096 + (hash2 >>> 0);
      this.app.debug(`Received point in mongo: ${JSON.stringify(point)}`);
      return point;
    } catch (err) {
      this.app.error(`getPoint error: ${err}`);
      return null;
    }
  }

  async send(point) {
    if (!this.isConnected) {
      await this.connect(); // Attempt to reconnect if not connected
    }
    if (this.isConnected) {
      try {
        if (this.buffer.size >= this.options.maxBuffer) {
          throw `Buffer exceeded: ${this.buffer.size}`;
        }
        point = this.getPoint(point);
        if (!point) return; // Ensure point is valid before proceeding
        this.buffer.set(point.uid, point);
        if (this.buffer.size >= this.options.batchSize || Date.now() > this.flushExpiry) {
          await this.flush();
        }
      } catch (err) {
        this.app.error(`Send error: ${err}`);
      }
    } else {
      this.app.error('Unable to send data: MongoDB connection is not established');
    }
  }

  housekeeping() {
    const timeNow = new Date();
    for (const [key, point] of this.buffer) {
      if (timeNow > point.expiry) {
        this.buffer.delete(key);
      }
    }
    if (timeNow > this.flushExpiry) {
      this.flush();
    }
  }

  async flush() {
    if (this.flushing || !this.isConnected) return;
    this.flushing = true;
    let batches = Math.ceil(this.buffer.size / this.options.batchSize);
    const bufferIterator = this.buffer.values();
    while (batches--) {
      let duration = Date.now();
      let batch = [];
      for (let i = 0; i < this.options.batchSize; i++) {
        const point = bufferIterator.next().value;
        if (!point) break;
        batch.push(point);
      }
      if (batch.length > 0) {
        const db = this.dbClient.db(this.database); // Use configured database
        const collection = db.collection(this.collection); // Use configured collection
        await collection.insertMany(batch);
        console.error(`MongoDB database: ${this.database}, collection: ${this.collection}`);
        batch.forEach(point => this.buffer.delete(point.uid));
        this.app.debug(`Inserted ${batch.length} documents into MongoDB`);
      }
      duration = Date.now() - duration;
      this.app.debug(`Flushed ${batch.length} points in ${duration} msec`);
    }
    this.flushExpiry = new Date(Date.now() + this.flushMillis);
    this.flushing = false;
  }
}

module.exports = {
  MongoDb,
};
