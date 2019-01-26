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
const qs = require('qs');
const LOKI = require('lokijs');
const _ =  require('lodash');
const axios = require('axios');
const pollingtoevent = require('polling-to-event');
const EventEmitter = require("events");
const uuidv3 = require('uuid/v3');
const getUuidByString = require('uuid-by-string');
const sjcl = require('sjcl');
const moment = require('moment');
const LOKIFILE = './tmp/loki-ccp.json';
const BUFFERNAME = 'buffer';
const TENSECONDS = 10000;
const loki = new LOKI(LOKIFILE, { //auto save/load 
    autoload: true,
    autoloadCallback : () => {
        let buffer = loki.getCollection(BUFFERNAME);
        if (buffer === null) {
          buffer = loki.addCollection(BUFFERNAME, {
            indicies: ['tangled','uuid'],
            unique: ['uuid'],
            ttl: 3.6e6, //one hour
            ttlInterval: 7.2e6, //two hours
          });
        }
    },
    autosave: true,
    autosaveInterval: 1e4 //once every ten minutes
});

//local stuff
const _defaults = { //ccp endpoints
    username: 'steve.melnikoff@penta.global',
    password: 'Ccp@1234',
    authenticateUrl:  'https://clientapi.ccp-network.com/Token',
    dashboardUrl: 'https://clientapi.ccp-network.com/api/Dashboard',
    interval: 1e4, //once ten seconds for testing, msec.
    token: null,
    uuid: getUuidByString('penta.global'),
    timestampFormat: 'D/M/YYYY H:mm:ss'
};
let EVENTS = null;
let _config = null;
let _ccp = null;
class CCP extends EventEmitter { //make any sensor an event emitter for consistent implementation

    constructor(events, config = {}) {
        super();
        EVENTS = events;
        _config = config;
        this._poll = null;
        _ccp = this;
     //   _ccp.on(EVENTS.TANGLE, this.tangle);
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


   async authenticate() {
        const  config = {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json'
            }
        };
        let data = qs.stringify({
            grant_type:'password',
            username:_config.username,
            password:_config.password
        });
        try {
            return await axios.post(_config.authenticateUrl, data, config);
        } catch (err) {
            console.error(err);
        }
    } //eo authenticate

    setToken(token = null){  
        _config._token = token; 
    } //eo setToken
    token() { 
        return _config._token; 
    } //eo token
   /*  emit(data) {
        if(!data) { return; } //do nothing if no data
        //loop over items, format and send to tangle
    } */
   /*  tangle() {
        loki.saveDatabase(() => { //always save before continuing
            // get all docs in collection without meta or $loki
            //coll.chain().data({ removeMeta: true });
            let buffer = loki.getCollection(BUFFERNAME);
            let tangled = buffer.chain().find({tangled:false}).data({removeMeta:true});
            let emitAndUpdate = () => { //emit here to SensorNode etal
                _ccp.emit(EVENTS.SENSORNODE, tangled);
                buffer.findAndUpdate({tangled:false}, (d) => {
                    d.tangled = true;
                });
            };
            buffer.ensureIndex('tangled'); //rebuild indexes to prevent dups
            tangled.length > 0 ? emitAndUpdate() : _.noop();
        });
    } //eo tangle */
    poll(interval = TENSECONDS) {
        let request = async (done) => { //use async/await with done fcn.
            let authorization = 'Bearer ' + _config.token.data.access_token;
            try {
                const response = await axios({
                    method: 'get',
                    url: _config.dashboardUrl,
                    headers: {
                        Authorization: authorization
                    }
                });
                done(null, response.data);
            } catch(err) {
                done(err);
            }
        }; //eo request
        
        let success = (data) => {
            /* let date = new Date();
            let file = './tmp/' + date.toISOString() + '.json';
            let json = JSON.stringify(data);
            console.log("Event emitted at %s, with data:\n", date.toLocaleString(), json);
            jsonfile.writeFile(file, data)
            .then(res => {
            console.log('Write complete to: '+ file);
            })
            .catch(err => console.error(err)); */
            //loop over data obj.
            //if new data -> add to outgoing for emitter
            //decide what will be the format for tangle emitter:
            //tag: location ID + sensor id
            let buffer = loki.getCollection(BUFFERNAME);
            let meta = null;
            let keys = _.keys(data); //this is done here so not to be done repeatedly in update
            const update = (d) => { //d is sensor data obj., arr is LocationList
                if( _.has(d,'TagSerialNumber') === false) { return; } //sanity check
                //last bits before writing to tangle and then to thingsboard
                let sensorId = [d.SiteName, d.LocationName, d.TagSerialNumber].join('-')
                let tag = _ccp.generateSeed(27);
                let sampleTime = d.TemperatureSampleTime || moment().format(_config.timestampFormat); //use what the tag reports or now
                let ts = moment(sampleTime, _config.timestampFormat).valueOf();
                let uuid = uuidv3(sensorId+ts,_config.uuid); //add a uuid to the data
                /* let insert = () => {
                    _.merge(d, {
                        uuid:uuid,
                        tag: tag,
                        tangled: false,
                        ts: ts,
                        location: {'lat': 37.99017, 'lng': 145.04071}
                    });
                    buffer.insert(d);
                }; */
                d.SiteName = d.SiteName.length > 0 ? d.SiteName : 'Penta';
                _.merge(d, meta);
                try {
                   // buffer.find({uuid:uuid}).length > 0 ? _.noop() : insert();
                   _.merge(d, {
                        uuid:uuid,
                        tag: tag,
                        tangled: false,
                        ts: ts,
                        location: {'lat': 37.99017, 'lng': 145.04071}
                    });
                    buffer.insert(d);
                } catch(err) {
                    console.log('ERR inserted -------------------\n', JSON.stringify(d));
                }

            }; //eo update
            const tangle = () => { //check this!!
                    // get all docs in collection without meta or $loki
                let tangled = buffer.chain().find({tangled:false}).data({removeMeta:true});
                let emitAndUpdate = () => { //emit here to SensorNode etal
                    _ccp.emit(EVENTS.SENSORNODE, tangled);
                    buffer.findAndUpdate({tangled:false}, (d) => {
                        d.tangled = true;
                    });
                };
                buffer.ensureIndex('tangled'); //rebuild indexes to prevent dups
                tangled.length > 0 ? emitAndUpdate() : _.noop();
            } //eo tangle

            _.remove(keys, (key) => key === 'LocationList' );
            meta = _.pick(data, keys);
            loki.saveDatabase(() => { //always save before continuing
                buffer.ensureAllIndexes(true); //rebuild indexes to prevent dups
                _.has(data, 'LocationList') ? data.LocationList.forEach(update) : _.noop();  
               tangle();
            });

        }; //eo success
        let failure = (err) => {
            console.log("Emitter errored: %s. with data \n%j", err, data);
        };
        let createPoll = () => { //poll ccp according to given interval
            this._poll = pollingtoevent(request, {
                interval:interval
            });
            this._poll.on('poll', success); 
            this._poll.on('error', failure);
        };
        try {
            this._poll ? _.noop() : createPoll();
        } catch(err) {
            console.error(err);
    
        }
    } //eo poll

    init() {
        try {
          //  _config = config;
            _.defaults(_config, _defaults); //handle defaults
            console.log(JSON.stringify(_config));
        } catch (err) {
            console.error(err);
        }
        return this;
    } //eo init
    start(interval = TENSECONDS) {
        this.init().authenticate().then((token) => {
            _config.token = token ? token : null;
            this.poll(interval);
        });
    }
    stop() {
        this._poll.clear();
        this._poll = null;
    }
    pause() {
        this._poll.pause();
    }
    resume() {
        this._poll.resume();
    }
    generateSeed(len = 81) { //generate trytes according to some length
        let seed = "";
        for(;seed.length < 81;seed += sjcl.codec.base64.fromBits(sjcl.random.randomWords(33, 10)).replace(/[^A-Z9]+/g, '')) {};
        return seed.substring(0,len);
    } //eo generateSeed
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

//##                   EXPORTS               ##
module.exports = CCP;

