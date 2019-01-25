/**
 * A temperature reading is recieved from one of the CCP sensors
 * @param {clyde.TemperatureReading} reading - the CCP sensor reading
 * @transaction
 */
async function TemperatureReading( reading ) {
    
    if (reading.SR.Readings) {
        reading.SR.Readings.push( reading.SD );
    } else {
        reading.SR.Readings = [ reading.SD ]
    }
  
    let sensorRegistry = getAssetRegistry('clyde.SensorReadings')
    return getAssetRegistry('clyde.SensorReadings')
        .then(function (assetRegistry) {
            return assetRegistry.update( reading.SR );
        });
}