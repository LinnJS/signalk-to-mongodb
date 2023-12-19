const { MongoDb } = require('./mongodb');

module.exports = function (app) {
    var plugin = {};
    var options = null;
    var mongodb = null;
    var unsubscribes = [];
    let selfContext;

    let getSelfContext = function () {
        const selfUuid = app.getSelfPath('uuid');
        const selfMmsi = app.getSelfPath('mmsi');

        if (selfUuid != null) {
            return "vessels." + selfUuid;
        } else if (selfMmsi != null) {
            return "vessels.urn:mrn:imo:mmsi:" + selfMmsi.toString();
        }
        return null;
    };

    plugin.handleUpdates = function (delta, pathOption) {
        delta.updates.forEach(update => {
            if (!update.values) {
                return;
            }

            update.values.forEach(val => {
                try {
                    let payload = {
                        'source': update["$source"],
                        'context': delta.context,
                        'path': val.path,
                        'value': val.value,
                        'time': update.timestamp
                    };

                    options.defaultTags.forEach(tag => {
                        payload[tag.name] = tag.value;
                    });

                    pathOption.pathTags.forEach(tag => {
                        payload[tag.name] = tag.value;
                    });

                    if (options.tagAsSelf === true && delta.context.localeCompare(selfContext) === 0) {
                        payload["self"] = true;
                    }

                    mongodb.send(payload);

                } catch (error) {
                    app.error(`skipping update: ${JSON.stringify(val)} error: ${JSON.stringify(error)}`);
                }
            });
        });
    };

    plugin.start = function (opts, restart) {
        app.error("plugin started");
        options = opts;
        selfContext = getSelfContext();
        mongodb = new MongoDb(app, options.dbUri);
        mongodb.start(options);

        options.pathArray.forEach(pathOption => {
            if (pathOption.enabled === true) {
                let localSubscription = {
                    "context": pathOption.context,
                    "subscribe": [{
                        "path": pathOption.path,
                        "policy": "instant",
                        "minPeriod": pathOption.interval
                    }]
                };

                app.subscriptionmanager.subscribe(
                    localSubscription,
                    unsubscribes,
                    subscriptionError => {
                        app.error('error: ' + subscriptionError);
                    },
                    delta => {
                        this.handleUpdates(delta, pathOption);
                    }
                );
                app.debug(`added subscription to: ${JSON.stringify(localSubscription)}`);
            } else {
                app.error(`skipping subscription to: ${pathOption.context}/.../${pathOption.path}`);
            }
        });
    };

    plugin.stop = function () {
        unsubscribes.forEach(f => f());
        unsubscribes = [];
        mongodb.stop();
        app.debug('plugin stopped');
    };

    plugin.id = 'signalk-to-mongodb-atlas';
    plugin.name = 'SignalK to MongoDB Atlas';
    plugin.description = 'Signalk plugin to send data to mongoDB Atlas';
    plugin.schema = {
      "type": "object",
      "description": "This plugin sends data to a MongoDB Atlas database (note: a server restart is needed for updated settings to take effect)",
      "properties": {
          "dbUri": {
              "type": "string",
              "title": "MongoDB URI",
              "description": "The URI to connect to MongoDB"
          },
          "batchSize": {
              "type": "number",
              "title": "Batch Size",
              "description": "the number of values to send in a single batch to the MongoDB Atlas endpoint",
              "default": 100
          },
          "flushSecs": {
              "type": "number",
              "title": "Flush Interval",
              "description": "maximum time in seconds to keep points in an unflushed batch, 0 means don't periodically flush",
              "default": 60
          },
          "maxBuffer": {
              "type": "number",
              "title": "Maximum Buffer Size",
              "description": "maximum size of the buffer - it contains items that could not be sent for the first time",
              "default": 1000
          },
          "ttlSecs": {
              "type": "number",
              "title": "Maximum Time to Live",
              "description": "maximum time to buffer data in seconds - older data is automatically removed from the buffer (i.e. and not sent)",
              "default": 180
          },
          "tagAsSelf": {
              "type": "boolean",
              "title": "Tag as 'self' if applicable",
              "description": "tag measurements as {self: true} when from vessel.self - requires an MMSI or UUID to be set in the Vessel Base Data on the Server->Settings page",
              "default": true
          },
          "defaultTags": {
              "type": "array",
              "title": "Default Tags",
              "description": "default tags added to every measurement",
              "default": [],
              "items": {
                  "type": "object",
                  "required": ["name", "value"],
                  "properties": {
                      "name": {
                          "type": "string",
                          "title": "Tag Name"
                      },
                      "value": {
                          "type": "string",
                          "title": "Tag Value"
                      }
                  }
              }
          },
          "pathArray": {
              "type": "array",
              "title": "Paths",
              "default": [],
              "items": {
                  "type": "object",
                  "required": ["context", "path", "interval"],
                  "properties": {
                      "enabled": {
                          "type": "boolean",
                          "title": "Enabled?",
                          "description": "enable writes to MongoDB Atlas for this path (server restart is required)",
                          "default": true
                      },
                      "context": {
                          "type": "string",
                          "title": "SignalK context",
                          "description": "context to record e.g.'self' for own ship, or 'vessels.*' for all vessels, or '*' for everything",
                          "default": "self"
                      },
                      "path": {
                          "type": "string",
                          "title": "SignalK path",
                          "description": "path to record e.g.'navigation.position' for positions, or 'navigation.*' for all navigation data, or '*' for everything"
                      },
                      "interval": {
                          "type": "number",
                          "description": "minimum milliseconds between data records",
                          "title": "Recording interval",
                          "default": 1000
                      },
                      "pathTags": {
                          "title": "Path tags",
                          "type": "array",
                          "description": "Define any tags to include for this path:",
                          "default": [],
                          "items": {
                              "type": "object",
                              "required": ["name", "value"],
                              "properties": {
                                  "name": {
                                      "type": "string",
                                      "title": "Tag Name"
                                  },
                                  "value": {
                                      "type": "string",
                                      "title": "Tag Value"
                                  }
                              }
                          }
                      }
                  }
              }
          }
      }
  };
  

    return plugin;
};
