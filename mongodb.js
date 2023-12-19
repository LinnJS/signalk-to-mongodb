const { MongoClient } = require('mongodb');

class MongoDb {
    buffer = new Map();
    options = null;
    app = null;
    timer = null;
    flushExpiry = new Date();
    flushMillis = 0;
    ttlMillis = settings.defaultTtlMillis;
    flushing = false;

    dbClient = null; // MongoDB client

    constructor(app, dbUri) {
        this.app = app;
        this.dbUri = dbUri;
        this.dbClient = new MongoClient(dbUri, { useNewUrlParser: true, useUnifiedTopology: true });
    }

    start(options) {
        this.app.debug(`mongodb options: ${JSON.stringify(options)}`);
        this.options = options;
        if (options.ttlSecs != null) {
            this.ttlMillis = options.ttlSecs * 1000;
        }

        if (this.options.flushSecs != null) {
            if (this.options.flushSecs > 0) {
                this.flushMillis = this.options.flushSecs * 1000;
                this.flushExpiry = new Date(new Date().getTime() + this.flushMillis);
            }
        }

        this.timer = setInterval(this.housekeeping, options.housekeepingMillis);

        this.dbClient.connect()
            .then(() => this.app.debug('Connected to MongoDB'))
            .catch(err => this.app.error('Error connecting to MongoDB:', err));
    }

    stop() {
        this.flush();

        if (this.timer) {
            clearInterval(this.timer);
            this.timer = null;
        }

        if (this.dbClient) {
            this.dbClient.close();
        }
    }

    getPoint = (point) => {
        try {
            if (point.time == null) {
                point.time = new Date();
            }

            point.expiry = new Date(new Date().getTime() + this.ttlMillis);

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
            return point;

        } catch (err) {
            this.app.error(`point: ${err}`);
            return null;
        }
    };

    send = (point) => {
        try {
            if (this.buffer.size >= this.options.maxBuffer) {
                throw `buffer exceeded: ${this.buffer.size}`;
            }

            point = this.getPoint(point);
            this.buffer.set(point.uid, point);

            const timeNow = new Date();
            if (this.buffer.size >= this.options.batchSize || timeNow > this.flushExpiry) {
                this.flush();
            }

        } catch (err) {
            this.app.error(`send: ${err}`);
        }
    }

    housekeeping = () => {
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

    flush = async () => {
        if (this.flushing === true) return;

        try {
            this.flushing = true;
            let batches = Math.floor(this.buffer.size / this.options.batchSize);
            if (new Date() > this.flushExpiry) {
                batches++;
            }

            const bufferIterator = this.buffer.entries();
            while (batches--) {
                let duration = new Date().getTime();
                let batch = [];
                let c = this.options.batchSize;

                while (c--) {
                    let point = bufferIterator.next().value;
                    if (point == null || point == undefined) break;
                    batch.push(point[1]);
                }

                if (batch.length > 0) {
                    const db = this.dbClient.db('prod'); // Set your database name
                    const collection = db.collection('nmea'); // Set your collection name

                    await collection.insertMany(batch);
                    batch.forEach(point => {
                        this.buffer.delete(point.uid);
                    });
                    this.app.debug(`Inserted ${batch.length} documents into MongoDB`);
                }

                duration = new Date().getTime() - duration;
                this.app.debug(`Flushed ${batch.length} points in ${duration} msec`);
            }
        } catch (err) {
            this.app.error(`flush: ${err}`);
        } finally {
            this.flushExpiry = new Date(new Date().getTime() + this.flushMillis);
            this.flushing = false;
        }
    }
}

module.exports = {
    MongoDb
};
