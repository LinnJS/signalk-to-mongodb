const { MongoDb } = require('./mongodb');

/**
 * @fileoverview This file contains a SignalK plugin that sends data to MongoDB.
 * For more information, please refer to the Signalk plugin documentation:
 * {@link https://demo.signalk.org/documentation/develop/plugins/server_plugin.html}
 */
``;

/**
 * Factory function to create a SignalK plugin that sends data to MongoDB.
 * @param {Object} app - The SignalK server application instance.
 * @returns {Object} The plugin object with start and stop capabilities.
 */
module.exports = function (app) {
  let plugin = {};
  let options = null;
  let mongodb = null;
  let unsubscribes = [];
  let selfContext;

  /**
   * Determines the 'self' context from the SignalK server settings.
   * @returns {string|null} The self context string or null if not found.
   */
  let getSelfContext = function () {
    const selfUuid = app.getSelfPath('uuid');
    const selfMmsi = app.getSelfPath('mmsi');

    if (selfUuid) {
      return 'vessels.' + selfUuid;
    } else if (selfMmsi) {
      return 'vessels.urn:mrn:imo:mmsi:' + selfMmsi.toString();
    }
    return null;
  };

  /**
   * Handles incoming data updates from SignalK paths and forwards them to MongoDB.
   * @param {Object} delta - The SignalK delta message containing updates.
   * @param {Object} pathOption - Configuration for specific SignalK path handling.
   */
  plugin.handleUpdates = function (delta, pathOption) {
    app.debug(`handleUpdates delta: ${JSON.stringify(delta)}`);
    app.debug(`handleUpdates pathOption: ${JSON.stringify(pathOption)}`);
  
    delta.updates.forEach(update => {
      app.debug(`handleUpdates update: ${JSON.stringify(update)}`);
      if (!update.values) {
        return;
      }
  
      update.values.forEach(val => {
        try {
          let payload = {
            source: update['$source'],
            context: delta.context,
            path: val.path,
            time: update.timestamp,
          };
  
          if (val.path === 'navigation.position') {
            payload.value = {
              type: "Point",
              coordinates: [val.value.longitude, val.value.latitude]
            };
          } else {
            payload.value = val.value;
          }
  
          options.defaultTags.forEach(tag => {
            payload[tag.name] = tag.value;
          });
  
          pathOption.pathTags.forEach(tag => {
            payload[tag.name] = tag.value;
          });
  
          if (options.tagAsSelf && delta.context.localeCompare(selfContext) === 0) {
            payload['self'] = true;
          }
  
          app.debug(`handleUpdates sending payload: ${JSON.stringify(payload)}`);
          mongodb.send(payload);
        } catch (error) {
          app.error(`Skipping update due to error: ${JSON.stringify(val)}, error: ${error.message}`);
        }
      });
    });
  };
  

  /**
   * Starts the plugin, setting up MongoDB connection and subscriptions to SignalK paths.
   * @param {Object} opts - Configuration options for the plugin.
   * @param {Function} restart - Callback to restart the plugin with new settings.
   */
  plugin.start = function (opts, restart) {
    app.debug('Plugin started');
    options = opts;
    selfContext = getSelfContext();
    app.debug(`Self context: ${selfContext}`);
    mongodb = new MongoDb(app, options.dbUri, options.database, options.collection);
    mongodb.start(options);

    options.pathArray.forEach(pathOption => {
      app.debug('Configuring pathOption: ' + JSON.stringify(pathOption));

      if (pathOption.enabled) {
        let localSubscription = {
          context: pathOption.context,
          subscribe: [
            {
              path: pathOption.path,
              policy: 'instant',
              minPeriod: pathOption.interval,
            },
          ],
        };

        app.subscriptionmanager.subscribe(
          localSubscription,
          unsubscribes,
          subscriptionError => {
            app.error(`Subscription error: ${subscriptionError}`);
          },
          delta => {
            this.handleUpdates(delta, pathOption);
          }
        );
        app.debug(`Added subscription for: ${JSON.stringify(localSubscription)}`);
      } else {
        app.error(`Skipping subscription for: ${pathOption.context}/.../${pathOption.path}`);
      }
    });
  };

  /**
   * Stops the plugin, unsubscribing from all paths and closing MongoDB connection.
   */
  plugin.stop = function () {
    unsubscribes.forEach(f => f());
    unsubscribes = [];
    if (mongodb) {
      mongodb.stop();
      app.debug('MongoDB connection stopped');
    }
    app.debug('Plugin stopped');
  };

  // Plugin metadata and schema for configuration
  plugin.id = 'signalk-to-mongodb';
  plugin.name = 'SignalK to MongoDB Plugin';
  plugin.description = 'This plugin sends SignalK data updates to a configured MongoDB instance.';

  // Plugin configuration schema
  plugin.schema = {
    type: 'object',
    properties: {
      dbUri: { type: 'string', title: 'MongoDB URI', description: 'The URI to connect to your MongoDB instance' },
      database: { type: 'string', title: 'Database Name', description: 'The name of the MongoDB database to use' },
      collection: {
        type: 'string',
        title: 'Collection Name',
        description: 'The name of the MongoDB collection to use',
      },
      batchSize: {
        type: 'number',
        title: 'Batch Size',
        default: 100,
        description: 'Number of values to send in a single batch to the MongoDB endpoint',
      },
      flushSecs: {
        type: 'number',
        title: 'Flush Interval',
        default: 60,
        description: "Maximum time in seconds to keep points in an unflushed batch, 0 means don't periodically flush",
      },
      maxBuffer: {
        type: 'number',
        title: 'Maximum Buffer Size',
        default: 1000,
        description: 'Maximum size of the buffer - it contains items that could not be sent for the first time',
      },
      ttlSecs: {
        type: 'number',
        title: 'Maximum Time to Live',
        default: 180,
        description: 'Maximum time to buffer data in seconds - older data is automatically removed from the buffer',
      },
      tagAsSelf: {
        type: 'boolean',
        title: "Tag as 'self' if applicable",
        default: true,
        description:
          'Tag measurements as {self: true} when from vessel.self - requires an MMSI or UUID to be set in the Vessel Base Data on the Server->Settings page',
      },
      defaultTags: {
        type: 'array',
        title: 'Default Tags',
        default: [],
        description: 'Default tags added to every measurement',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string', title: 'Tag Name' },
            value: { type: 'string', title: 'Tag Value' },
          },
          required: ['name', 'value'],
        },
      },
      pathArray: {
        type: 'array',
        title: 'Paths',
        default: [],
        description: 'Configure paths for data recording',
        items: {
          type: 'object',
          properties: {
            enabled: {
              type: 'boolean',
              title: 'Enabled',
              default: true,
              description: 'Enable writes to MongoDB for this path',
            },
            context: {
              type: 'string',
              title: 'SignalK context',
              description: "Context to record, e.g., 'self' for own ship, 'vessels.*' for all vessels",
            },
            path: { type: 'string', title: 'SignalK path', description: "Path to record, e.g., 'navigation.position'" },
            interval: {
              type: 'number',
              title: 'Recording interval',
              default: 1000,
              description: 'Minimum milliseconds between data records',
            },
            pathTags: {
              type: 'array',
              title: 'Path Tags',
              default: [],
              description: 'Define any tags to include for this path',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', title: 'Tag Name' },
                  value: { type: 'string', title: 'Tag Value' },
                },
                required: ['name', 'value'],
              },
            },
          },
          required: ['context', 'path', 'interval'],
        },
      },
    },
    required: ['dbUri', 'database', 'collection'],
  };

  return plugin;
};
