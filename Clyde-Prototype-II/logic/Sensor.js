'use strict';

/*-----------------------------------------------------------------------------
 * Node.js Interface to the CCP Sensors
 * Ed. Kazmierczak
 * 
 * Modified from Steve Melnikoff Node.js CCP sensor interface used here
 * with the permission of the author. 
 * @link   URL
 * @file   ccp.js
 * @author Steve Melnikoff.
 * @since  0.1.0
 * @copyright 2018 All rights reserved.
 * 
 */

const fs              = require('fs');
const queryString     = require('qs');
const _               = require('lodash');
const axios           = require('axios');
const https           = require('https');
const pollingtoevent  = require('polling-to-event');
const eventEmitter    = require("events");
const uuidv3          = require('uuid/v3');
const getUuidByString = require('uuid-by-string');
const sjcl            = require('sjcl');
const moment          = require('moment');

/*--------------------------------------------------------------------------------
 * Default configuration for CCP endpoints.
 *-------------------------------------------------------------------------------*/
const defaults = {
    username:         'ed.kazmierczak@gmail.com',
    password:         'Nephr0n!',
    authenticateUrl:  'https://clientapi.ccp-network.com/Token',
    dashboardUrl:     'https://clientapi.ccp-network.com/api/Dashboard',
    interval:         null,
    token:            null,
    //  The full user uuid is the device 'id' combined with the time stamp and 
    //  ending in gmail.com.
    uuid:             getUuidByString('gmail.com'), 
    timestampFormat:  'D/M/YYYY H:mm:ss'
};

let Events = null;
let Config = null;
let sensor = null;
let poll   = null;

/*---------------------------------------------------------------------------------
 * Sensor class - Methods for interacting with CCP sensors.
 * Every 'Sensor' object is also a js eventEmitter and is capable of emitting and
 * listening for events.
 * ------------------------------------------------------------------------------*/

class Sensor extends eventEmitter {

    constructor( events, config={}, timerInterval ) {
        super();
        Events = events
        Config = config;
        // Set up the global configuration
        Config = _.defaults(Config, defaults, config);
        Config.interval = timerInterval;
        // Accept all certificates including self signed certificates
        https.globalAgent.options.rejectUnauthorized = false;
        // Keep a reference to 'this' object
        sensor = this;
    }  // End of Constructor

    start() {
        // Start the process by first authenticating and then polling for data. 

        const authenticate = async () => {
            // CCP sensors use 'token based authenatication'. The function connects to the CCP
            // sensors, validates the user and returns an access token.
            const  local_config =
                        {
                        headers: {  'Content-Type': 'application/x-www-form-urlencoded',
                                    'Accept': 'application/json'  },
                        httpsAgent: new https.Agent({ rejectUnauthorized: false })
                        };

            let data = queryString.stringify({
                            grant_type:'password',
                            username:defaults.username,
                            password:defaults.password
                        });

            try {
                return await axios.post(defaults.authenticateUrl, data, local_config);
            } catch (err) {
                console.error(err);
            }
        } // End of 'authenticate'

        // First authenticate and then start polling.
        authenticate().then((token) => {
            Config.token = token ? token : null;
            this.polling(Config.interval);
        });
    } // End of 'start'

    polling(interval = timePeriods.FIVEMINUTES) {
        // Poll the sensors with the specified interval. 

        let request = async (done) => {
            // Create a 'Bearer' token
            let authorization = 'Bearer ' + Config.token.data.access_token;
            // Connect to the CCP sensor via the CCP dashboard
            try {
                const response = await axios({
                                                method:  'get',
                                                url:     Config.dashboardUrl,
                                                headers: { Authorization: authorization }
                                            });
                done(null, response.data);
            } catch(err) {
                done(err);
            }
        }; //End of 'request'

        let success = (data) => {
            // Parameters: 'data' is the data from the sensors for this round.
            // First create a new null 'meta' object and an empty buffer.
            let meta = null;
            let buf = [];

            const generateSeed = (len = 81) => { 
                //'generateSeed' is part of the original implementation that connects to 'iota'. 
                // It generates trytes according to some length and is left here in the event that
                // we would want to connect to 'iota'.
                let seed = "";
                for(;seed.length < 81;seed += sjcl.codec.base64.fromBits(sjcl.random.randomWords(33, 10)).replace(/[^A-Z9]+/g, '')) {};
                return seed.substring(0,len);
            } //End ofgenerateSeed

            const update = (d) => {
                // Parameter: 'd' is sensor data object and arr is LocationList

                //uuid uniquely identifies this sensor telemetry point, uses ts plus sensor id!
                if( _.has(d,'TagSerialNumber') === false) { return; } //sanity check

                //last bits before writing to thingsboard
                const device     = [d.SiteName, d.LocationName, d.TagSerialNumber].join('-');
                const tag        = generateSeed(27); //this is an iota tag for one transaction
                const sampleTime = d.TemperatureSampleTime || moment().format(Config.timestampFormat); //use what the tag reports or now
                const ts         = moment(sampleTime, Config.timestampFormat).valueOf();
                const uuid       = uuidv3(device+ts,Config.uuid); //add a uuid to the data
                d.SiteName       = d.SiteName.length > 0 ? d.SiteName : 'Penta';

                _.merge(d, meta);

                try {
                   _.merge(d, {
                        device: device,
                        uuid:uuid,
                        tag: tag,
                        tangled: false,
                        published: false,
                        ts: ts,
                        hash: '',
                        tangle: '',
                        lat: -37.7128197,
                        lng: 145.1587373
                    });
                    // Generate a 'TELEMETRY' event to notify listeners that a new sensor value is
                    // ready.
                    sensor.emit(Events.TELEMETRY, d); 
                    // buf.push(d);
                } catch(err) {
                    console.log('ERR inserted -------------------\n', err, JSON.stringify(d));
                }
            }; //End ofupdate

            const getMeta = () => {
                let keys = _.keys(data); //this is done here so not to be done repeatedly in update
                _.remove(keys, (key) => key === 'LocationList' );
                return _.pick(data, keys);
            };

            if(_.has(data, 'LocationList')) {
                meta = getMeta();
                data.LocationList.forEach(update);
                // sensor.emit(Events.TELEMETRY, buf); //move data to sensorNode
                // if( Events.TELEMETRY ) { console.log('Telemetry')}
                console.log('CCP data sent to SensorNode');
            }
        }; //End ofsuccess

        const failure = (err) => {
            console.log("Emitter errored: %s", err);
            poll.clear();
            createPoll();
        };

        const createPoll = () => { //poll ccp according to given interval
            poll = pollingtoevent(request, {
                interval:interval
            });
            poll.on('poll', success);
            poll.on('error', failure);
        };
        try {
            poll ? _.noop() : createPoll();
        } catch(err) {
            console.error(err);

        }
    } //End of 'polling'

    setToken(token = null){
        Config._token = token;
    } //End of setToken

    token() {
        return Config._token;
    } //End oftoken

    stop() {
        poll.clear();
        poll = null;
    }

    pause() {
        poll.pause();
    }

    resume() {
        poll.resume();
    }

/*------------------------------------------------------------------------------
 * Axios testing
 *-----------------------------------------------------------------------------*/
    axiosTest() {
    // GET request for remote image
            axios({
            method:'get',
            url:'http://bit.ly/2mTM3nY',
            responseType:'stream'
        })
        .then(function(response) {
        response.data.pipe(fs.createWriteStream('ada_lovelace.jpg'))
        });
    } //End ofaxiosTest

} //End ofclass

module.exports.Sensor = Sensor;
