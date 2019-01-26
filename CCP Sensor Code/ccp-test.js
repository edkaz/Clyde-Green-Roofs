let ccp = require('./ccp.js')
let sensor = new ccp.CCP( {}, {} )
sensor.axiosTest();
sensor.start();