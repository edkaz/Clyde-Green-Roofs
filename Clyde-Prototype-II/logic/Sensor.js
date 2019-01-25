'use strict';

/**
 * Summary. (use period)
 *
 * Description. nodejs interface to ccp sensor api
 *
 * @link   URL
 * @file   ccp.js
 * @author Steve Melnikoff.
 * @
 * @since  0.1.0
 * @copyright 2018 All rights reserved.
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

/* Defaults for CCP Endpoints */
const defaults = {
    username:         'ed.kazmierczak@gmail.com',
    password:         'Nephr0n!',
    authenticateUrl:  'https://clientapi.ccp-network.com/Token',
    dashboardUrl:     'https://clientapi.ccp-network.com/api/Dashboard',
    interval:         null,
    token:            null,
    uuid:             getUuidByString('gmail.com'), //This is combined with a device id + ts
    timestampFormat:  'D/M/YYYY H:mm:ss'
};

let Events = null;
let Config = null;
let sensor = null;
let poll   = null;

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
        // Authenticate and connect to the sensors and then start polling.
        const authenticate = async () => {
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
            // Parameters: 'data' is the data from the polling.
            // First create a new null 'meta' object and an empty buffer.
            let meta = null;
            let buf = [];

            const generateSeed = (len = 81) => { //generate trytes according to some length
                let seed = "";
                for(;seed.length < 81;seed += sjcl.codec.base64.fromBits(sjcl.random.randomWords(33, 10)).replace(/[^A-Z9]+/g, '')) {};
                return seed.substring(0,len);
            } //End ofgenerateSeed

            const update = (d) => {
                // Parameter: 'd' is sensor data object and arr is LocationList

                //uuid uniquely identifies this sensor telemetry point, uses ts plus sensor id!
                if( _.has(d,'TagSerialNumber') === false) { return; } //sanity check

                //last bits before writing to tangle and then to thingsboard
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
                    // TODO need to wrap this up in the appropriate try-catrch.
                    sensor.emit(Events.TELEMETRY, d); //move data to sensorNode
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

    //Testing

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
