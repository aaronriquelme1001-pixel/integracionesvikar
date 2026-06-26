const { BigQuery } = require('@google-cloud/bigquery');

const bigquery = new BigQuery({
  projectId: 'vikargpsdatos',
  keyFilename: './bq-key.json'
});

const datasetId = 'telemetry';
const tableId = 'global_traffic';

const schema = [
  { name: 'imei', type: 'STRING', mode: 'REQUIRED' },
  { name: 'plate', type: 'STRING', mode: 'NULLABLE' },
  { name: 'lat', type: 'FLOAT64', mode: 'NULLABLE' },
  { name: 'lng', type: 'FLOAT64', mode: 'NULLABLE' },
  { name: 'speed', type: 'FLOAT64', mode: 'NULLABLE' },
  { name: 'dt_tracker', type: 'TIMESTAMP', mode: 'NULLABLE' },
  { name: 'client_source', type: 'STRING', mode: 'NULLABLE' },
  { name: 'created_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
  { name: 'altitude', type: 'FLOAT64', mode: 'NULLABLE' },
  { name: 'angle', type: 'FLOAT64', mode: 'NULLABLE' },
  { name: 'params', type: 'STRING', mode: 'NULLABLE' },
  { name: 'loc_valid', type: 'BOOLEAN', mode: 'NULLABLE' }
];

async function init() {
  try {
    console.log(`Checking dataset ${datasetId}...`);
    const [datasetExists] = await bigquery.dataset(datasetId).exists();
    if (!datasetExists) {
      console.log(`Creating dataset ${datasetId}...`);
      await bigquery.createDataset(datasetId, { location: 'US' });
    }

    console.log(`Checking table ${tableId}...`);
    const dataset = bigquery.dataset(datasetId);
    const [tableExists] = await dataset.table(tableId).exists();
    if (!tableExists) {
      console.log(`Creating table ${tableId}...`);
      const options = {
        schema: schema,
        timePartitioning: {
          type: 'DAY',
          field: 'dt_tracker',
        }
      };
      await dataset.createTable(tableId, options);
      console.log(`Table ${tableId} created with time partitioning.`);
    } else {
      console.log(`Table ${tableId} already exists.`);
    }
    console.log('✅ BigQuery initialization complete.');
  } catch (error) {
    console.error('❌ Error initializing BigQuery:', error);
  }
}

init();
