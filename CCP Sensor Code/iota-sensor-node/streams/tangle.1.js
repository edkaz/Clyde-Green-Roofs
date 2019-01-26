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
const jsonfile = require('jsonfile');
const sjcl = require('sjcl');
const IOTA = require('iota.lib.js');
const IOTADEVNET =  'https://nodes.devnet.thetangle.org:443';
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
  constructor (_stream) {
    _stream = _stream || {};
    this.iota = new IOTA({
        'host': _stream.host || IOTADEVNET,
        'port': _stream.port || 14265
    });

    this.id = _stream.id || 'SensorNode';
    //http://maps.google.com/maps?q=&layer=c&cbll=40.65,-73.91 //NY?
    //http://maps.google.com/maps?q=&layer=c&cbll=-37.99017,145.04071 //Beaumaris

    this.location = _stream.location || {'lat': 37.99017, 'lng': 145.04071};
    this.source = null;

    this.seed = _stream.seed || this.generateSeed();
    this.rec_address = _stream.rec || 'GPB9PBNCJTPGFZ9CCAOPCZBFMBSMMFMARZAKBMJFMTSECEBRWMGLPTYZRAFKUFOGJQVWVUPPABLTTLCIA'; /*nowhere*/
    this.tag = _stream.tag || 'SENSORNODEROCKS'; //sensor

    this.wait = (_stream.wait == false ? false : true);	/* discards packets till the current packet has been send */
    this.busy = false;

    this.depth = _stream.depth || 3;
  } //eo constructor

  //##             HANDLE SOURCE using events              ##
  handle (d) {
    /* abort sending while first fetch or lock until message is sent */
    console.log('-------------------\n',d.TemperatureSampleTime, '\n', JSON.stringify(d));

    if (this.wait && this.busy) { return null; }

     /* if (this.wait) */
  //   this.busy = true;
/*  this.source().then(data => {
         this.attachToTangle(data);
       }).catch(error => {console.log(error);}) */

     // console.log('event emitter sent:',JSON.stringify(data));

  } //eo handle

  //#############################################
  //##            ATTACH TO TANGLE             ##
  //#############################################

  attachToTangle (_data) {

    const scope = this;
    const time = Date.now();
    const ts = '\x1b[94m' + time + '\x1b[0m ';
    const transfersArray = [];
    //loop over data items and create a transfer to be pushed into array
    let json = {
      'id':         this.id, //
      'location':   this.location,
      'timestamp':  time,
      'data':       _data,
    }

   console.log('\nJSON (\x1b[94mTangle\x1b[0m):')
   console.log(json);
   let trytes = this.iota.utils.toTrytes(JSON.stringify(json));
   //console.log("\nTRYTES:\n" + trytes);
   console.log('\n\x1b[93m[attaching ' + time + ']\x1b[0m\n');
    /* var transfersArray = [{
          'address': this.rec_address,
          'value': 0,
          'message': trytes,
          'tag': this.tag
    }]; */

    const prepareTranfersCallback = (err, bundle) => {
      return err ? failure(err, -1) : scope.iota.api.sendTrytes(bundle, scope.depth, 14, sendTrytesCallback);
    };
    const sendTrytesCallback = (err, result) => {
      return err ? failure(err, -2) : success(result);
    }; //eo sendTrytesCallback
    const success = (d) => {
      console.log(ts + '\x1b[32mATTACHED (hash: ' + result[0].hash + ')\x1b[0m');
      /* if (scope.wait) */
       scope.busy = false;
    }
    const failure = (err, i) => {
      console.log(ts + '\x1b[41mERROR\x1b[0m (' + err + ')');
      return i;
    }
     /* PREPARE TRANSFERS, then send */
     this.iota.api.prepareTransfers(this.seed, transfersArray, prepareTranfersCallback);
  }

  //#############################################
  //##                 HELPERS                 ##
  //#############################################

  /** Generate several random words, and return them in an array.
   * A word consists of 32 bits (4 bytes)
   * @param {Number} nwords The number of words to generate.
   */
 // randomWords: function (nwords, paranoia) {
    generateSeed() {
        let seed = "";
        for(;seed.length < 81;seed += sjcl.codec.base64.fromBits(sjcl.random.randomWords(33, 10)).replace(/[^A-Z9]+/g, '')) {};
        return seed.substring(0,81);
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
