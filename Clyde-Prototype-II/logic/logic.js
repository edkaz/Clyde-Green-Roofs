/*-----------------------------------------------------------------------
 * InitialiseReading
 * Initialises a temperature reading asset.
 * @param {}
 * @transaction
 * ----------------------------------------------------------------------*/
asynch function InitialiseReading() {
    // Create an empty SensorReading. This is the initial transition of the
    // the SensorReadings asset state-machine.
    let sensorRegistry = getAssetRegistry('clyde.SensorReadings');
    let factory = getFactory();
    let reading = factory.newResource('clyde.com', 'SensorReadings', 'null');
    reading.Readings = [];
    return sensorRegistry.add(reading);
}

/*------------------------------------------------------------------------
 * TemperatureReading
 * A temperature reading is recieved from one of the CCP sensors and
 * added to the blockchain. 
 * @param {clyde.TemperatureReading} reading - the CCP sensor reading
 * @transaction
 * ----------------------------------------------------------------------*/
async function TemperatureReading( reading ) {
    
    if (reading.SR.Readings) {
        reading.SR.Readings.push( reading.SD );
    } else {
        reading.SR.Readings = [ reading.SD ];
    }
  
    let sensorRegistry = getAssetRegistry('clyde.SensorReadings');
    return getAssetRegistry('clyde.SensorReadings')
        .then(function (assetRegistry) {
            return assetRegistry.update( reading.SR );
        });
}