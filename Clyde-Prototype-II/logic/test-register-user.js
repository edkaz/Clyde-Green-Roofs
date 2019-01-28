'use strict';

/*-----------------------------------------------------------------------------------------------
 *  Enroling a Usewr into the IBM Cloud fabric
 * 
 *  Adapted from the IBM fabcar example it requires the IBM cloud fabric's connection profile - 
 *  connection-profile.json - is a JSON object specifying the connection parameters. 
 * 
 *  Ed. Kazmierczak, Dec. 2018.
 * 
 *---------------------------------------------------------------------------------------------*/

var Fabric_Client    = require('fabric-client');
var Fabric_CA_Client = require('fabric-ca-client');

var path = require('path');
var util = require('util');
var os   = require('os');

//---------- Initialisation --------------------------------------------------------------------

var fabric_client    = new Fabric_Client();
var fabric_ca_client = null;
var admin_user       = null;
var member_user      = null;
var store_path       = path.join(__dirname, 'hfc-key-store');

/*---------- Key Value Store -----------------------------------------------------------
 * Create the key value store as defined in the fabric-client/config/default.json 'key-value-store' setting
 */

Fabric_Client.newDefaultKeyValueStore({ path: store_path
}).then((state_store) => {

    // Assign the store to the fabric client
    fabric_client.setStateStore(state_store);

    // The store used for certificates is the same for admin users and regular users. Ensure that we connect
    // to the same store (see test-admin.)
    var crypto_suite = Fabric_Client.newCryptoSuite();
    var crypto_store = Fabric_Client.newCryptoKeyStore({path: store_path});
    crypto_suite.setCryptoKeyStore(crypto_store);
    fabric_client.setCryptoSuite(crypto_suite);
    var	tlsOptions = {
    	trustedRoots: [],
    	verify: false
    };
    fabric_ca_client = new Fabric_CA_Client('https://admin:391b2cbb4c@n1c9b5898e164420da5682972809501b6-org1-ca.us05.blockchain.ibm.com:31011', null , '', crypto_suite);

    // First find the administrator for the network.
    return fabric_client.getUserContext('admin', true);
}).then((user_from_store) => {
    if (user_from_store && user_from_store.isEnrolled()) {
        console.log('Successfully loaded admin from persistence');
        admin_user = user_from_store;
    } else {
        throw new Error('Failed to get administrator .... run test-enrol-admin.js');
    }

    //  At this point we should have the admin user who is can then perform the necessary registration. 
    //  Step 1 - Register the user with the CA server. The admin user provides us with a token ('secret') 
    //  that enables the user to be registered.
    
    return fabric_ca_client.register({enrolmentID: 'user1', affiliation: 'org1.department1', role: 'client'}, admin_user);
}).then((secret) => {

    console.log('Successfully registered user1 - secret:'+ secret);

    // Enrol the user and return a valid X.509 certificate for the new user. 
    return fabric_ca_client.enroll({enrolmentID: 'user1', enrolmentSecret: secret});

}).then((enrolment) => {

    // Create a user instance with the generated certificates.
    console.log('Successfully enrolled member user "user1" ');
    return fabric_client.createUser(
        {username: 'user1',
         mspid:    'org1',
         cryptoContent: { privateKeyPEM: enrolment.key.toBytes(), signedCertPEM: enrolment.certificate }
        });

}).then((user) => {
     member_user = user;
     return fabric_client.setUserContext(member_user);

}).then(()=>{
     console.log('User1 was successfully registered and enrolled and is ready to interact with the fabric network');

}).catch((err) => {
    console.error('Failed to register: ' + err);
	if(err.toString().indexOf('Authorization') > -1) {
		console.error('Authorization failures may be caused by having admin credentials from a previous CA instance.\n' +
		'Try again after deleting the contents of the store directory ' + store_path);
	}
});