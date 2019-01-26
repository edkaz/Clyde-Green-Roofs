'use strict';

/**
 * Summary. (use period)
 *
 * Description. nodejs interface to ccp sensor api
 *
 * @link   URL
 * @file   ccp.js
 * @author Steve Melnikoff.
 * @since  0.1.0
 * @copyright 2018 All rights reserved.
 */


const fs = require('fs');
const queryString = require('qs');
const _ =  require('lodash');
const axios = require('axios');
const https = require('https');
const pollingtoevent = require('polling-to-event');
const EventEmitter = require("events");
const uuidv3 = require('uuid/v3');
const getUuidByString = require('uuid-by-string');
const sjcl = require('sjcl');
const moment = require('moment');
const TENSECONDS = 1e4;
const SIXTYSECONDS = 6e4;
const FIVEMINUTES = 3e5;
const TENMINUTES = 6e5;
const ONEHOUR = 36e5;


//local stuff
const defaults = { //ccp endpoints
    username: 'steve.melnikoff@penta.global',
    password: 'Ccp@1234',
    authenticateUrl:  'https://clientapi.ccp-network.com/Token',
    dashboardUrl: 'https://clientapi.ccp-network.com/api/Dashboard',
    interval: FIVEMINUTES, //once ten seconds for testing, msec.
    token: null,
    uuid: getUuidByString('penta.global'), //this is combined with a device id + ts
    timestampFormat: 'D/M/YYYY H:mm:ss'
};
let EVENTS = null;
let config = null;
let ccp = null; //this
let poll = null; //periodic function to get data from CCP sensors
class CCP extends EventEmitter { //make any sensor an event emitter for consistent implementation

    constructor(events, c = {}) {
        super();
        EVENTS = events;
        config = c;
        config = _.defaults(config, defaults, c); //handle defaults
        https.globalAgent.options.rejectUnauthorized = false; //self signed certificate handling
        ccp = this;
    } //eo constructor

    /* Authenticating the User:
    We use token based authentication. So, to use the Web API, we need to generate OAuth Bearer token, which will be used as an authentication token for subsequent API request to fetch results.
    • URL “https://clientapi.ccp-network.com/Token”.
    • Method POST
    • URL Params x-www-form-urlencoded
    • Data Params
    [ex: password] [ex:ant@ccp.com] [ex: CCp@1234]
    grant_type:
    username:
    password:
    Content_type: [ex:application/x-www-form-urlencoded] Accept: [ex:application/json]
    • Success Response {
    "access_token": "NSjhX6oaWnFJBsp1f5QJETsqVXV_uLVgF0- FGxRPOZqLOpHvVcPRagUgwZvjlSJYXBPnhmNJKxfE0HmlfX9CTMRVr_- ZjGEF9kqiMpSI9oeII_rMIwhrq21S5WIOiVJJeS3 ",
    "token_type": "bearer", "expires_in": 2591999, "userName": "test@ccp.com",
    CCP Web API Documentation
    Page 1 of 9
    Monitoring Critical Control Points
    ".issued": "Mon, 21 May 2018 11:11:48 GMT", ".expires": "Wed, 20 Jun 2018 11:11:48 GMT"
    }
    • Error Response
    {
    "error": "invalid_grant",
    "error_description": "The user name or password is incorrect."
    } */
    //pass configuration and any data object keyed by sensor serial id
    start() {
        const authenticate = async () => {
            const  config = {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Accept': 'application/json'
                },
                httpsAgent: new https.Agent({
                    rejectUnauthorized: false
                })
            };
            let data = queryString.stringify({
                grant_type:'password',
                username:defaults.username,
                password:defaults.password
            });
            try {
                return await axios.post(defaults.authenticateUrl, data, config);
            } catch (err) {
                console.error(err);
            }
        } //eo authenticate
        authenticate().then((token) => { //authenticate and take data at regular intervals
            config.token = token ? token : null;
            this.polling(config.interval);
        });
    } //eo start

    polling(interval = FIVEMINUTES) {
        let request = async (done) => { //use async/await with done fcn.
            let authorization = 'Bearer ' + config.token.data.access_token;
            try {
                const response = await axios({
                    method: 'get',
                    url: config.dashboardUrl,
                    headers: {
                        Authorization: authorization
                    }
                });
                done(null, response.data);
            } catch(err) {
                done(err);
            }
        }; //eo request
        
        let success = (data) => { //data from ccp polling see ./tmp/ccp_raw.json
            let meta = null; //create a meta object
            let buf = [];
            const generateSeed = (len = 81) => { //generate trytes according to some length
                let seed = "";
                for(;seed.length < 81;seed += sjcl.codec.base64.fromBits(sjcl.random.randomWords(33, 10)).replace(/[^A-Z9]+/g, '')) {};
                return seed.substring(0,len);
            } //eo generateSeed
            const update = (d) => { //d is sensor data obj., arr is LocationList
                //uuid uniquely identifies this sensor telemetry point,uses ts plus sensor id!
                if( _.has(d,'TagSerialNumber') === false) { return; } //sanity check
                //last bits before writing to tangle and then to thingsboard
                const device = [d.SiteName, d.LocationName, d.TagSerialNumber].join('-');
                const tag = generateSeed(27); //this is an iota tag for one transaction
                const sampleTime = d.TemperatureSampleTime || moment().format(config.timestampFormat); //use what the tag reports or now
                const ts = moment(sampleTime, config.timestampFormat).valueOf();
                const uuid = uuidv3(device+ts,config.uuid); //add a uuid to the data
                d.SiteName = d.SiteName.length > 0 ? d.SiteName : 'Penta';
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
                        lat: -37.990,
                        lng: 145.041
                    });
                    buf.push(d);
                } catch(err) {
                    console.log('ERR inserted -------------------\n', err, JSON.stringify(d));
                }
            }; //eo update
            const getMeta = () => {
                let keys = _.keys(data); //this is done here so not to be done repeatedly in update
                _.remove(keys, (key) => key === 'LocationList' );
                return _.pick(data, keys);
            };
            if(_.has(data, 'LocationList')) {
                meta = getMeta();
                data.LocationList.forEach(update);
                ccp.emit(EVENTS.TELEMETRY, buf); //move data to sensorNode
                console.log('CCP data sent to SensorNode');
            }
           
        }; //eo success
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
    } //eo polling

    setToken(token = null){  
        config._token = token; 
    } //eo setToken
    token() { 
        return config._token; 
    } //eo token

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
    //testing
    
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
    } //eo axiosTest

} //eo class

let sensor = new CCP( null, {} )
sensor.axiosTest()

//##                   EXPORTS               ##
module.exports.CCP = CCP;

