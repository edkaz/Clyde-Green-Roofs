'use strict';

/**
 * Summary. (use period)
 *
 * Description. nodejs interface to ccp sensor api
 *
 * @link   URL
 * @file   index.js
 * @author Steve Melnikoff.
 * @since  0.1.0
 * @copyright 2018 All rights reserved.
 */
const CCP = require('./ccp');
const TANGLE = require('./streams/tangle');
const LOKI = require('lokijs');
const _ = require('lodash');
const pollingtoevent = require('polling-to-event');
const jsonfile = require('jsonfile');
const EventEmitter = require("events");
const THINGSBOARD = require('thingsboard/thingsboard5');

const EVENTS = {
    TELEMETRY: 'telemetry',
    LOKILOADED: 'loaded', //this is what Loki emits when db is loaded
    POLL: 'poll',
    TANGLE: 'tangle',
    SENSORNODE: 'sensornode',
    IOTA: 'iota',
    PUBLISH: 'publish',
    PUBLISHDEVICES: 'publishdevices'
};
const LOKIFILE = './tmp/loki-sensornode.json';
//const LOKIFILE = './tmp/loki-tangle.json'; //testing data
const BUFFERNAME = 'buffer';
const TENSECONDS = 1e4;
const SIXTYSECONDS = 6e4;
const TWOMINUTES = 12e4;
const FIVEMINUTES = 3e5;
const TENMINUTES = 6e5;
const ONEHOUR = 36e5;
const STARTDEVICES = true;
const STARTDASHBOARD = false;
let loki = null;
//local stuff
const _defaults = { //ccp endpoints
    interval: TWOMINUTES, //once ten seconds for testing, msec.
};
let sensornode = null;
let config = null;
let pollBlockchain = null; //periodically get untangled data and send to iota/hyperledger etc.
let pollDashboard = null;

class SENSORNODE extends EventEmitter {
    constructor(c = {}) { //pass in the array of devices/sensors
        super();
        config = _.defaults(config, _defaults, c); //handle defaults
        sensornode = this; //keep reference to this 
        loki = new LOKI(LOKIFILE, { //auto save/load 
            autosave: true,
            autosaveInterval: SIXTYSECONDS,
            autoload: true,
            autoloadCallback : () => { //emits loaded event todo: one db multiple collections
                if (loki.getCollection(BUFFERNAME) === null) {
                    loki.addCollection(BUFFERNAME, {
                        autoupdate: true,
                        indices: ['tangled', 'published', 'uuid'],
                        unique: ['uuid'] //uuid combines device and ts
                    });
                }
            },
            autosave: true, 
            autosaveInterval: TENSECONDS //once a minute maybe
        });
        loki.on(EVENTS.LOKILOADED, sensornode.start); //loki loaded can now start
        //do something when app is closing
        process.on('exit', sensornode.onExit.bind(null,{cleanup:true}));
        //catches ctrl+c event
        process.on('SIGINT', sensornode.onExit.bind(null, {exit:true}));
    } //eo constructor

    start() { //main start for SensorNode, wrap CCP, TANGLE and Thingsboard via events/msgs
        const ccp = new CCP(EVENTS);
        const dashboard = new THINGSBOARD(EVENTS);
        STARTDEVICES ? sensornode.startDevices([ccp]) : _.noop();
        dashboard.on(EVENTS.PUBLISH, sensornode.startDashboard); //wait until dashboard is up and running
        sensornode.on(EVENTS.PUBLISH, dashboard.publishTelemetry); //publish data to thingsboard
        sensornode.startTangle();
    } //eo start
    startDevices(devices) { //for every device stream tell it to get started/polling
        const addToBuffer= (data = []) => { //interface between device and sensorNode binding
            let buffer = loki.getCollection(BUFFERNAME);
            const insert = () => {
                data.forEach((d) => {
                    try {
                        buffer.insert(d);
                    } catch(err) {
                        //duplicate key error?
                        console.log(err, d.uuid)
                    }
                })
            };
            buffer && data.length > 0 ? insert() : _.noop();
        } //eo addToBuffer
        devices.forEach(device => {
            device.on(EVENTS.TELEMETRY, addToBuffer); //sensor published data, add to queue for blockchain/thingsboard
            device.start(); //begin device polling for data
        });
    } //eo startDevices

    //poll event, add data to this.buffer
    //streams responsible for formatting transaction
    //collect data every so often and write to blockchain/tangle
    startTangle() {
        const buffer = loki.getCollection(BUFFERNAME);
        const tangle = new TANGLE();
        const blockchains = [];
        const polling = (done) => { //use async/await with done fcn.
            let data = null;
            try {
                data  = buffer.chain().find({tangled:false}).data({removeMeta:true});
                done(null, data);
            } catch(err) {
                done(err, data)
            }
        }; //eo request
        const sendToBlockchains = (data = []) => { //pass data to each stream for handling
            console.log("SensorNode poll success with data \n", JSON.stringify(data));
            const tangled = (data) => { //read entangled bits and save to database
                const update = (d) => { //d is one data item returned from the blockchain/tangle
                    buffer.chain().find({ tag: d.tag })
                    .update((o) => { // o are the returned find objects that match the blockchain tag
                        o.hash = d.hash;
                        o.tangle = d;
                        o.tangled = true;
                        o.published = false;
                    });
                } //eo update one doc
                //if tangle timeout then it resolves with []
                data.forEach(update); //for each of the entangled results, get the data item by item and attach the hash
            }; //eo tangled
            const save = () => { //save the updated data
                loki.saveDatabase(BUFFERNAME);
            }; 
            const handle = (chain) => { //chain.handle writes data to the tangle then promise is resolved
                //chain.handle returns promise, and then tangled updates loki for future publishing
                chain.handle(data).then(tangled, failure).then(save); //move tangled into pollingTangled
            } //eo handle
            data.length > 0 ? blockchains.forEach(handle) : _.noop(); //handle multiple blockchains, for now only one: tangle
        }; //eo sendToBlockchains
        const failure = (err, data) => {
            console.log("SensorNode poll errored: %s. with data \n%j", err, data);
        };
        const createPoll = () => { //poll loki according to given interval
            pollBlockchain = pollingtoevent(polling, {
                interval:config.interval
            });
            pollBlockchain.on('poll', sendToBlockchains); //after polling success
            pollBlockchain.on('error', failure); 
        }; //eo createPoll
       
        try { //set up a poll to send data to iota and then update loki buffer
            blockchains.push(tangle);
            pollBlockchain ? _.noop() : createPoll();
        } catch(err) {
            console.error(err);
        }
    } //eo startTangle
    startDashboard() {
        const polling = (done) => { //use async/await with done fcn.
            let buffer = loki.getCollection(BUFFERNAME);
            let data = [];
            try {
                //data = buffer.chain().find({tangled:true, published:false}).simplesort('TagSerialNumber').data({removeMeta:true});
                data = buffer.chain().find({tangled:true, published:false})
                .update((o) => { // o is the loki-sensornode collection 
                    o.published = true;
                })
              //  .simplesort('TagSerialNumber')
                .data({removeMeta:true});
                done(null, data);
            } catch(err) {
                done(err, data)
            }
        }; //eo request
        const sendToDashboard = (data) => { //pass data to each stream for handling
            console.log("dashboard poll success with data length:", data.length);
            sensornode.emit(EVENTS.PUBLISH, data);
        }; //eo success
        const failure = (err, data) => {
            console.log("device poll errored: %s \n", err);
        };
        const createPoll = () => { //poll ccp according to given interval
            pollDashboard = pollingtoevent(polling, {
                interval:config.interval
            });
            console.log('dashboard polling started')
            pollDashboard.on('poll', sendToDashboard); 
            pollDashboard.on('error', failure);
        }; //eo createPoll
       
        try {
            pollDashboard ? _.noop() : createPoll();
        } catch(err) {
            console.error(err);
        }
    } //eo startDashboard
    
    startPublish() { //get entangled from database and publish to thingsboard
        let buffer = loki.getCollection(BUFFERNAME);
        let data = buffer.chain().find({tangled:true, published:false}).data({removeMeta:true});
        sensornode.emit(EVENTS.PUBLISH, data);
      //  sensornode.tangled();
    }
   
   onExit(options, exitCode) {
    loki.close();
    if (exitCode || exitCode === 0) console.log('SensorNode exiting:',exitCode);
    if (options.exit) process.exit();
   }

    stop() {
        loki.saveDatabase(BUFFERNAME);
        poll.clear();
        poll = null;
    }
    pause() {
        loki.saveDatabase(BUFFERNAME);
        poll.pause();
    }
    resume() {
        loki.saveDatabase(BUFFERNAME);
        poll.resume();
    }
    tangledTest() { //read entangled bits and save to database
        //use this for thingsboard too
        const file = './tmp/iotaMultiTransactions.json'
        const success = (results) => {
            const buffer = loki.getCollection(BUFFERNAME);
            const data = [];
            const done = () => {
                const d = data;
                //emit published data here
            }
            const update = (hash) => {
                buffer.chain().find({ tag: hash.tag })
                .update((o) => { // o is the loki-sensornode collection 
                    o.hash = hash;
                    o.tangled = true;
                    o.published = false;
                    data.push(o);
                });
            } //eo update one doc
            results.forEach(update); //for each of the entangled results, get the data item by item and attach the hash
            loki.saveDatabase((err) => {
                err ? _.noop() : done(data);
            });
            
        }
        jsonfile.readFile(file).then(success,failure);
    } //eo tangledTest
    tangleTest() {
        const success = (data) => {
           // sensornode.emit(EVENTS.PUBLISH, data);
           let buffer = loki.getCollection(BUFFERNAME);
            try {
                data.forEach((d) => {
                    buffer.insert(d);
                });
            } catch(err) {
                console.log(err);
            }
        };
        const failure = (err) => {
            console.log(err);
        };
        jsonfile.readFile(TANGLEDFILE).then(success,failure);
        // sensornode.emit(EVENTS.PUBLISH, data);
    } //eo tangleTest

} //eo SENSORNODE

   /*exports.init = () => {
    
  tangle.writeSeed()
    .then((file) => {
        console.log('resolved seed in file:',file);
    }); 
    tangle.readSeed()
    .then(seed => {
        console.log('resolved seed:',seed)
    })
    
} */

module.exports = SENSORNODE;
