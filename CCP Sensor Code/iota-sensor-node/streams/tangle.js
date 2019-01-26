'use strict';

/**
 * Summary. (use period)
 *
 * Description. nodejs interface to ccp sensor api
 *
 * @link   URL
 * @file   tangle.js
 * @author Steve Melnikoff.
 * @since  0.1.0
 * @copyright 2018 All rights reserved.
 */



//#############################################
//##                  SETUP                  ##
//#############################################
const fs = require('fs');
const _ = require('lodash');
const jsonfile = require('jsonfile');
const sjcl = require('sjcl');
const timeLimitPromise = require('time-limit-promise');
const IOTA = require('iota.lib.js');
//const IOTADEVNET =  'https://nodes.devnet.thetangle.org:443';
const IOTADEVNET =  'https://nodes.devnet.iota.org:443';
const TENSECONDS = 1e4;
const SIXTYSECONDS = 6e4;
const TWOMINUTES = 12e4;
let tanglestream = null;
let transfers = null;
//#############################################
//##        TANGLESTREAM CONSTRUCTOR         ##
//#############################################

class TANGLESTREAM {
  /* Parameter	Function	Default
  host	(Remote-) node we're connecting to.	0.0.0.0
  port	Iota-api port on the node.	14265
  id	Identifies the streamobject.	"SensorNode"
  location	Nodes location, eg. 'lat': 52.26 'lng': 13.42.	{'lat': 40.65, 'lng': -73.91}
  seed	Seed for creating transactions/MAM-messages.	[generated]
  rec	Receiving address (tanglestream only).	"GPB9PBNCJTPGF..."
  tag	Tag for Transactions (tanglestream only).	"SENSORNODEROCKS"
  depth	Depth for tip-selection (tanglestream only).	3
  wait	Discards packets till the current packet has been send.	true
  fetch	Enable continuous fetching from MAM-root when multiple nodes stream from the same seed (mamstream only).	false */
  constructor (config) {
    config = config || {};
    this.iota = new IOTA({
       /*  'host': config.host || IOTADEVNET,
     //   'port': config.port || 14265
        'port': config.port || 443 */
        'provider': config.provider || IOTADEVNET
    });

    this.id = config.id || 'SensorNode';
    //http://maps.google.com/maps?q=&layer=c&cbll=40.65,-73.91 //NY?
    //http://maps.google.com/maps?q=&layer=c&cbll=-37.99017,145.04071 //Beaumaris

    this.location = config.location || {'lat': 37.99017, 'lng': 145.04071};
    this.source = null;
    this.seed = config.seed || this.generateSeed();
    this.rec_address = config.rec || 'GPB9PBNCJTPGFZ9CCAOPCZBFMBSMMFMARZAKBMJFMTSECEBRWMGLPTYZRAFKUFOGJQVWVUPPABLTTLCIA'; /*nowhere*/
    this.tag = config.tag || 'PENTANODEROCKS'; //sensor
   // this.wait = config.wait || false;	/* discards packets till the current packet has been send */
  //  this.busy = false;
    this.depth = config.depth || 3;
    tanglestream = this;
  } //eo constructor

  //##             HANDLE SOURCE using events              ##
  async handle (data) {
    /* abort sending while first fetch or lock until message is sent */
  //  console.log('-------------------\n',d.TemperatureSampleTime, '\n', JSON.stringify(d));
    const scope = this;
    let result = null;

  //  const map = new Map();
    const transfersArray = [];
   // const attachToTangle = this.attachToTangle;
    const tangle = (d) => {
      const promise = new Promise((resolve, reject) => {
        scope.attachToTangle.call(scope, resolve, reject, d); //?
      });
      return timeLimitPromise(promise, SIXTYSECONDS, { resolveWith: [] })
    }; //eo tangle
    try {
  //    if (this.wait && this.busy) { return null; }
   //   this.busy = true;
      data.forEach((d) =>{ // prepare the untangled data and then add to transfersArray
        let o = this.transfersObject(d)
        o ? transfersArray.push(o) : _.noop();
      });
     // addToMap(data); //not used
  //    map.set(transfersArray, tangle); //what to do, since there is only a single map entry no loop needed
      /* for (let [d, fcn] of map.entries()) {
        result = await fcn(d);
        console.log(JSON.stringify(result));
      } */
      result = await tangle(transfersArray);
      //data.length > 0 ? this.attachToTangle(data) : _.noop();
    } catch(err) {
      result = null;
      console.log(err);
    }
    return result;
  } //eo handle

  //#############################################
  //##            ATTACH TO TANGLE             ##
  //#############################################
  transfersObject(d) {
    const time = Date.now();
    let o = null;
    let trytes = null;
    try {
      let json = {
        'id':         d.uuid, //
        'location':   d.location,
        'timestamp':  time,
        'data':       d
      };
      trytes = this.iota.utils.toTrytes(JSON.stringify(json));
      o = {
        'address': this.rec_address,
        'value': 0,
        'message': trytes,
        'tag': d.tag
      };
    } catch(err) {
      o = null;
    }
    return o;
  } //eo transfersObject
//  attachToTangle (resolve, reject, d) { 
  attachToTangle (resolve, reject, transfersArray) { 
    const scope = this;
    const prepareTranfersCallback = (err, bundle) => {
      return err ? failure(err, -1) : scope.iota.api.sendTrytes(bundle, scope.depth, 14, sendTrytesCallback);
    };
    const success = (result) => {
      console.log( '\x1b[32mATTACHED (hash: ' + result[0].hash + ')\x1b[0m');
 //      scope.busy = false;
       resolve(result);
    }
    const failure = (err, i) => {
      console.log( '\x1b[41mERROR\x1b[0m (' + err + ')');
//      scope.busy = false;
      reject(err);
    }
    const sendTrytesCallback = (err, result) => {
      return err ? failure(err, -2) : success(result);
    }; //eo sendTrytesCallback
    //loop over data items and create a transfer to be pushed into array
    /* PREPARE TRANSFERS, then send */

     this.iota.api.prepareTransfers(this.seed, transfersArray, prepareTranfersCallback);
  } //eo attachToTangle

  //#############################################
  //##                 HELPERS                 ##
  //#############################################

  /** Generate several random words, and return them in an array.
   * A word consists of 32 bits (4 bytes)
   * @param {Number} nwords The number of words to generate.
   */
 // randomWords: function (nwords, paranoia) {
    
    generateSeed(len = 81) {
        let seed = "";
        for(;seed.length < 81;seed += sjcl.codec.base64.fromBits(sjcl.random.randomWords(33, 10)).replace(/[^A-Z9]+/g, '')) {};
        return seed.substring(0,len);
    } //eo generateSeed

    writeSeed(seed = this.seed) {
        let date = new Date();
        let file = './tmp/' + date.toISOString() + '.json';
        let data = {
            created: date.toISOString(),
            date: date.toString()
        };
        data.seed = seed;
        return new Promise((resolve, reject) => {
          jsonfile.writeFile(file, data)
          .then(res => {
            resolve(file);
            console.log('Write complete to: '+ file);
          })
          .catch((err) => {
            reject(err);
            console.error(err);
          });
        }); //eo promise 
    } //eo writeSeed
    readSeed(file = './tmp/2018-09-19T01:48:52.804Z.json') {
      return new Promise((resolve, reject) => {
        jsonfile.readFile(file)
        .then(res => {
          resolve(res);
          console.log('read complete seed: '+ res);
        })
        .catch((err) => {
          reject(err);
          console.error(err);
        });
      }); //eo promise 
    } //eo readSeed

} //eo class

//##                   EXPORTS               ##
module.exports = TANGLESTREAM;
