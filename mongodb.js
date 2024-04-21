const { MongoClient } = require('mongodb');

/**
 * Default settings for MongoDB operations.
 * @type {Object}
 */
const settings = {
  housekeepingMillis: 30000, // Interval for housekeeping tasks in milliseconds
  responseMillis: 10000, // Maximum time to wait for the server to start responding
  deadlineMillis: 25000, // Maximum time to wait for a full response
  defaultTtlMillis: 60000, // Default time-to-live for data points in milliseconds
};

/**
 * Class to handle MongoDB operations with buffered management for batch operations.
 */
class MongoDb {
  /**
   * Constructs the MongoDB utility object.
   * @param {Object} app - The application interface for logging.
   * @param {string} dbUri - The MongoDB connection URI.
   * @param {string} database - The database name to connect to.
   * @param {string} collection - The collection to use within the database.
   */
  constructor(app, dbUri, database, collection) {
    this.app = app;
    this.dbUri = dbUri;
    this.database = database;
    this.collection = collection;
    this.dbClient = new MongoClient(dbUri, { useNewUrlParser: true, useUnifiedTopology: true });
    this.buffer = new Map();
    this.flushExpiry = new Date();
    this.flushMillis = 0;
    this.ttlMillis = settings.defaultTtlMillis;
    this.flushing = false;
    this.isConnected = false;
  }

  /**
   * Connects to the MongoDB server with retries on failure.
   * @param {number} [retryCount=5] - Maximum number of connection attempts.
   * @param {number} [retryDelay=1000] - Initial delay between retries, increases exponentially.
   * @throws {Error} Throws an error if all connection attempts fail.
   */
  async connect(retryCount = 5, retryDelay = 1000) {
    for (let attempt = 0; attempt < retryCount; attempt++) {
      try {
        await this.dbClient.connect();
        this.isConnected = true;
        this.app.debug(`Successfully connected to MongoDB on attempt ${attempt + 1}`);
        return;
      } catch (err) {
        this.app.error(`Failed to connect to MongoDB on attempt ${attempt + 1}: ${err.message}`);
        if (attempt < retryCount - 1) {
          let delay = retryDelay * Math.pow(2, attempt);
          this.app.debug(`Retrying connection in ${delay}ms`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    this.app.error('All MongoDB connection attempts failed');
    throw new Error('Unable to connect to MongoDB after multiple retries');
  }

  /**
   * Initializes and starts the MongoDB handler.
   * @param {Object} options - Custom configuration options.
   */
  async start(options) {
    this.options = { ...settings, ...options };
    await this.connect();
    this.timer = setInterval(() => this.housekeeping(), this.options.housekeepingMillis);
    this.app.debug('MongoDB handler has started');
  }

  /**
   * Stops the MongoDB handler and cleans up resources.
   */
  async stop() {
    clearInterval(this.timer);
    await this.flush();
    await this.dbClient.close();
    this.isConnected = false;
    this.app.debug('MongoDB connection closed');
  }

  /**
   * Processes and queues a single data point for MongoDB insertion.
   * @param {Object} point - The data point to process and send.
   */
  async send(point) {
    if (!this.isConnected) {
      this.app.error('Attempting to reconnect to MongoDB');
      await this.connect();
    }
    try {
      const enrichedPoint = this.preparePoint(point);
      this.buffer.set(enrichedPoint.uid, enrichedPoint);
      if (this.buffer.size >= this.options.batchSize || Date.now() > this.flushExpiry) {
        await this.flush();
      }
    } catch (err) {
      this.app.error(`Error sending data: ${err}`);
    }
  }

  /**
   * Prepares a data point by adding necessary metadata.
   * @param {Object} point - The raw data point.
   * @returns {Object} The enriched data point.
   */
  preparePoint(point) {
    point.time = point.time ? new Date(point.time) : new Date();
    point.expiry = new Date(Date.now() + this.ttlMillis);
    point.uid = this.generateUID(JSON.stringify(point));
    return point;
  }

  /**
   * Generates a unique identifier for a data point based on its JSON string representation.
   * @param {string} json - The JSON string of the data point.
   * @returns {number} The hash-based unique identifier.
   */
  generateUID(json) {
    let hash = 0;
    for (let i = 0; i < json.length; i++) {
      const character = json.charCodeAt(i);
      hash = (hash << 5) - hash + character;
      hash |= 0; // Convert to 32bit integer
    }
    return hash;
  }

  /**
   * Flushes the current buffer to MongoDB in batches.
   */
  async flush() {
    if (this.flushing || !this.isConnected) {
      this.app.debug('Flush attempt skipped: either already flushing or not connected.');
      return;
    }

    if (this.buffer.size === 0) {
      this.app.debug('Flush skipped: buffer is empty.');
      return; // Skip flushing and log that the buffer was empty
    }

    this.flushing = true;
    const keysToDelete = [];
    try {
      const batch = Array.from(this.buffer.values()).slice(0, this.options.batchSize);

      if (batch.length > 0) {
        const db = this.dbClient.db(this.database);
        const coll = db.collection(this.collection);
        await coll.insertMany(batch);
        batch.forEach(point => keysToDelete.push(point.uid));
        this.app.debug(`Flushed ${batch.length} points.`);
      } else {
        this.app.debug('Flush skipped: buffer is empty after preparation.');
      }
    } catch (err) {
      this.app.error(`Flush failed: ${err.message}`, err);
    } finally {
      keysToDelete.forEach(key => this.buffer.delete(key));
      this.flushExpiry = new Date(Date.now() + this.options.flushMillis);
      this.flushing = false;
    }
  }

  /**
   * Performs periodic cleanup and flushing tasks.
   */
  housekeeping() {
    const now = new Date();
    for (const [key, point] of this.buffer.entries()) {
      if (point.expiry < now) {
        this.buffer.delete(key);
      }
    }
    if (now > this.flushExpiry) {
      this.flush().catch(err => this.app.error(`Housekeeping flush failed: ${err}`));
    }
    this.app.debug('Housekeeping completed');
  }
}

module.exports = {
  MongoDb,
};
