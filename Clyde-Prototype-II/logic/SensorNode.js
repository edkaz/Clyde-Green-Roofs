const sensors     = require('./Sensor.js');
const json        = require('jsonfile')
const thingsBoard = require('thingsboard/thingsboard5');=
const events = {
                TELEMETRY:      'telemetry',
                LOKILOADED:     'loaded', //this is what Loki emits when db is loaded
                POLL:           'poll',
                TANGLE:         'tangle',
                SENSORNODE:     'sensornode',
                IOTA:           'iota',
                PUBLISH:        'publish',
                PUBLISHDEVICES: 'publishdevices'
            };
const timePeriods = {
                    TENSECONDS   : 1e4,
                    SIXTYSECONDS : 6e4,
                    FIVEMINUTES  : 3e5,
                    TENMINUTES   : 6e5,
                    ONEHOUR      : 36e5 
                };

