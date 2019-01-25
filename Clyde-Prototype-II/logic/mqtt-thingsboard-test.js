'use strict';

const ccp  = require('./Sensor.js');
const mqtt = require('mqtt');

const EVENTS = { //line #23 SensorNode.js
    TELEMETRY: 'telemetry',
    LOKILOADED: 'loaded', //this is what Loki emits when db is loaded
    POLL: 'poll',
    TANGLE: 'tangle',
    SENSORNODE: 'sensornode',
    IOTA: 'iota'
    PUBLISH: 'publish',
    PUBLISHDEVICES: 'publishdevices'
};

const timePeriods = {
    TENSECONDS   : 1e4,
    SIXTYSECONDS : 6e4,
    FIVEMINUTES  : 3e5,
    TENMINUTES   : 6e5,
    ONEHOUR      : 36e5
};

let sensor = new ccp.Sensor( EVENTS, {}, timePeriods.SIXTYSECONDS )
sensor.axiosTest();
sensor.start();
sensor.on(EVENTS.TELEMETRY, function( buf ){console.log('\n\n ----> ' + JSON.stringify(buf))} )


