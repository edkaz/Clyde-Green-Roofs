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
const jsonfile = require('jsonfile');
const qs = require('qs');
const _ =  require('lodash');
const axios = require('axios');
const pollingtoevent = require('polling-to-event');
const EventEmitter = require("events");
const uuidv4 = require('uuid/v4');

//ccp endpoints

//local stuff
const _defaults = {
    username: 'steve.melnikoff@penta.global',
    password: 'Ccp@1234',
    authenticateUrl:  'https://clientapi.ccp-network.com/Token',
    dashboardUrl: 'https://clientapi.ccp-network.com/api/Dashboard',
    interval: 10000, //once a minute, msec.
    POLLEVT: 'poll',
    token: null
};
let _d = null; //share sensor data object
let _config = null;

class CCP extends EventEmitter { //make any sensor an event emitter for consistent implementation

    constructor() {
        super();
        this._poll = null;
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
    init(config = {}, d = {}) {
        try {
            _config = config;
            _d = d;
            _.defaults(_config, _defaults); //handle defaults
            console.log(JSON.stringify(_config));
        } catch (err) {
            console.error(err);
        }
        return this;
    } //eo init

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
    }

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
    poll(interval = 900000) {
        let emitter = this;
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
                done(err, response.data)
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
            let keys = _.keys(data);
            _.remove(keys, (key) => key === 'LocationList' );
            let meta = _.pick(data, keys);
            const update = (d) => { //d is sensor data obj., arr is LocationList
                let t = null; //current TagSerialNumber
                let _dt = null; //_dt cached data for the given TagSerialNumber
                if( _.has(d,'TagSerialNumber') === false || _.has(d,'TemperatureSampleTime') === false) { return; } //sanity check
                t = d.TagSerialNumber;
                _dt = _d[t]; //may be undefined
                _d[t] = _dt ? _dt : d; //keep the same if exists, else point to incoming
                if(_dt && (_dt.TemperatureSampleTime === d.TemperatureSampleTime)) { 
                    return; 
                }
               // _.merge(d, attr);
                //last bits before writing to tangle and then to thingsboard
                d.SiteName = d.SiteName ? d.SiteName + '-CCP' : 'Penta-CCP';
                meta.tag = [d.SiteName, d.LocationName, d.TagSerialNumber].join('-')
                meta.uuid = uuidv4(); //add a uuid to the data
                meta.location = {'lat': 37.99017, 'lng': 145.04071};
                d.meta = meta;
                emitter.emit(_config.POLLEVT, d);

                console.log('-------------------\n',t, d.TemperatureSampleTime, '\n', JSON.stringify(d));
            };
            _.has(data, 'LocationList') ? _.forEach(data.LocationList, update) : _.noop();
        };
        let failure = (err, data) => {
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
    start(interval = 10000) {
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

