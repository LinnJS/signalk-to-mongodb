# SignalK to MongoDB Plugin

This SignalK server plugin facilitates the storage of vessel and environmental data into a MongoDB database. It allows for flexible configuration, enabling data from various SignalK paths to be collected, tagged, and stored efficiently. This is particularly useful for long-term data analysis and backup, real-time monitoring, and historical data retrieval.

## Features

- **Customizable Data Collection**: Configure which SignalK paths to monitor and store.
- **Efficient Data Handling**: Batch processing and flush controls for optimal performance.
- **Dynamic Tagging**: Add custom tags to stored data for easier categorization and querying.
- **Resilient Connection Handling**: Automatic retries and robust error handling.
- **Configurable Database Schema**: Specify database and collection names via plugin settings.

## Prerequisites

- **SignalK Server**: This plugin is an add-on for the SignalK Node server. Ensure that your SignalK server is correctly installed and operational.
- **MongoDB**: A MongoDB server instance accessible via URI.

## Installation

### Via SignalK App Store

The easiest way to install this plugin is through the SignalK App Store:

1. Open your SignalK server dashboard.
2. Go to **App Store**.
3. Search for **"SignalK to MongoDB"** and select it.
4. Click **Install** to add the plugin to your server.

### Manual Installation

If you prefer to install the plugin manually, follow these steps:

1. **Clone the Plugin**:
    ```bash
    cd ~/.signalk
    git clone https://github.com/yourusername/signalk-to-mongodb-plugin.git plugins/signalk-to-mongodb
    ```

2. **Install Dependencies**:
    Navigate to the plugin directory and install necessary NPM packages:
    ```bash
    cd plugins/signalk-to-mongodb
    npm install
    ```

3. **Activate the Plugin**:
    - Open your SignalK server dashboard.
    - Go to **Server > Plugin Config**.
    - Find **"SignalK to MongoDB"** and click the **Enable** button.
    - Configure the plugin settings as necessary.

## Configuration

Edit the configuration directly via the SignalK Server dashboard under **Server > Plugin Config > SignalK to MongoDB**. Here are the fields you need to configure:

- **MongoDB URI** (`dbUri`): The connection string to connect to your MongoDB database, e.g., `mongodb://localhost:27017`.
- **Database Name** (`database`): The name of the MongoDB database to use.
- **Collection Name** (`collection`): The name of the MongoDB collection to store the data.
- **Batch Size** (`batchSize`): The number of documents to store in one batch (default is 100).
- **Flush Interval** (`flushSecs`): Time in seconds to flush the data to database periodically (default is 60 seconds).
- **Maximum Buffer Size** (`maxBuffer`): Maximum number of entries to hold in buffer before forced flush (default is 1000).
- **Tag as 'self'** (`tagAsSelf`): Whether to tag entries as originating from 'self' vessel based on the server's base data settings.
- **Default Tags** (`defaultTags`): A list of tags added to every stored document.
- **Paths Configuration** (`pathArray`): Detailed configuration for paths to monitor.

## Usage

Once configured, the plugin will automatically start processing data based on the subscription paths set up in the configuration. It handles all aspects of data management, including connection persistence, data formatting, and storage.

## Community and Resources

- **SignalK Documentation**: [SignalK Docs](http://signalk.org/)
- **Community Support**: Join the [SignalK Discord](https://discord.com/invite/uuZrwz4dCSp) for community support and discussions.
- **SignalK GitHub Repository**: [SignalK GitHub](https://github.com/SignalK/signalk-server)

## Contributing

Contributions to the plugin are welcome. Please ensure that your code adheres to the existing style and includes updates to documentation as necessary.

1. **Fork the Repository** - Create your own fork of the project.
2. **Create Your Feature Branch** (`git checkout -b feature/AmazingFeature`).
3. **Commit Your Changes** (`git commit -m 'Add some AmazingFeature'`).
4. **Push to the Branch** (`git push origin feature/AmazingFeature`).
5. **Open a Pull Request**.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Acknowledgments

- Thanks to the SignalK community for their continuous support and inspiration.
