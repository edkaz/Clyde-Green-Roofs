'use strict';

const ccp    = require('./Sensor.js');
const mqtt   = require('mqtt');
const tokens = require('./SensorTokens');
const moment = require('moment');

//------- Environment Variables -------
const HostName = 'demo.thingsboard.io';

//------- Configure Clients -----------
// We use a 'dictionary' of client connections indexed by the 'Tag Serial Number'

const EVENTS = { //line #23 SensorNode.js
    TELEMETRY: 'telemetry',
    LOKILOADED: 'loaded', //this is what Loki emits when db is loaded
    POLL: 'poll',
    TANGLE: 'tangle',
    SENSORNODE: 'sensornode',
    IOTA: 'iota',
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

//------ Connections --------
let sensor = new ccp.Sensor( EVENTS, {}, timePeriods.SIXTYSECONDS )
sensor.axiosTest();
console.log('Sensors connected ... ');

//  The 'connections' object will store all of our Thingsboard clients.
//  We'll start with an empty object.
var connections = {}

// The 'tokens' variable holds a set of key/value pairs, the key being the sensor
// tag serial number and the value is its Thingsboard token. It is our 'connection profile'.

Object.keys(tokens).forEach( function(tag) {
  connections[tag] = mqtt.connect('mqtt://'+ HostName,{
      username: tokens[tag]
  });
  connections[tag].on('connect', function () {
    console.log("Connected to " + tag);
  });
});

//------ Auxiliary Functions --------

function ConvertUTC( date ){
  var fst = date.split(" ");
  var snd = fst[0].split("/");
  var thd = fst[1].split(":");
  return new Date(snd[2], snd[1], snd[0], thd[0], thd[1], thd[2]).getTime();
};

//------ Start Networks -------------
sensor.start();
console.log("Sensor network started ... ")

//------ Acquire Telemetry and POST it to Thingsboard --------
sensor.on(EVENTS.TELEMETRY, function( data ){
  var TagName      = data.TagSerialNumber;
  var TagValue     = data.TagTemperature;
  var SampleDate   = data.TemperatureSampleTime;
  var SampleTime   = new Date(SampleDate).getTime();
  var SampleTime   = ConvertUTC(SampleDate);
  var Telemetry    = {"ts": SampleTime, "values": {"Temperature": TagValue} };
  // Open a connection to Thingsboard and upload a single data value on a 
  // 'TELEMETRY' event.
  var client = mqtt.connect('mqtt://'+ HostName,{
      username: tokens[TagName]
  });
  connections[TagName].on('connect', function () {
    connections[TagName].publish('v1/devices/me/telemetry', JSON.stringify(Telemetry));
      console.log("Uploading telemetry to " + TagName);
  });
});

//Object.keys(tokens).forEach(function(tag) {
//    connections[tag].end();
//    console.log("Closed  " + tag + " ... ");
// });
