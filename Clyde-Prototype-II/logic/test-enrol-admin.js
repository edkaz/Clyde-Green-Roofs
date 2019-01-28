/*-----------------------------------------------------------------------------------------------
 *  Enroling Admin into the IBM Cloud fabric
 * 
 *  Adapted from the IBM fabcar example it requires the IBM cloud fabric's connection profile - 
 *  connection-profile.json - is a JSON object specifying the connection parameters. 
 * 
 *  Ed. Kazmierczak, Dec. 2018.
 * 
 *---------------------------------------------------------------------------------------------*/

var Fabric_Client    = require('fabric-client');
var Fabric_CA_Client = require('fabric-ca-client');

var path             = require('path');
var util             = require('util');
var os               = require('os');

//---------- Initialisation -------------------------------------------------------------------

var fabric_client    = new Fabric_Client();
var fabric_ca_client = null;
var admin_user       = null;
var member_user      = null;
var store_path       = path.join(__dirname, 'hfc-key-store');

console.log(store_path);

/*---------- Key Value Store ------------------------------------------------------------------
 * Create the key value store as defined in the fabric-client/config/default.json 
 * 'key-value-store'.
 */

Fabric_Client.newDefaultKeyValueStore({ path: store_path
}).then((state_store) => {

    // Assign the store to the fabric client. 
    fabric_client.setStateStore(state_store);
    var crypto_suite = Fabric_Client.newCryptoSuite();

    // Use the same location for the state store (where the users' certificate are kept)
    // and the crypto store (where the users' keys are kept)
    var crypto_store = Fabric_Client.newCryptoKeyStore({path: store_path});
    crypto_suite.setCryptoKeyStore(crypto_store);
    fabric_client.setCryptoSuite(crypto_suite);
    var	tlsOptions = {
    	trustedRoots: [],
    	verify: false
    };

    fabric_ca_client = new Fabric_CA_Client('https://admin:391b2cbb4c@n1c9b5898e164420da5682972809501b6-org1-ca.us05.blockchain.ibm.com:31011', tlsOptions , 'org1CA', crypto_suite);
    
    //  Return the admin user if they are already enrolled or a 'null'value otherwise. 
    return fabric_client.getUserContext('admin', true);
}).then((user_from_store) => {

    //  Check to see if there is an admin user already enrolled and if not enrol them.

    if (user_from_store && user_from_store.isEnrolled()) {
        // The user is already enrolled.
        console.log('Successfully loaded admin from persistence');
        admin_user = user_from_store;
        return null;
    } else {
        // Otherwise enrol the user using the CA server.
        return fabric_ca_client.enroll({
          enrollmentID: 'admin',
          enrollmentSecret: '391b2cbb4c' // The enrollment sectret from the connection profile. 
                                         // TODO: Replace hard coded data with connection profile data.
        }).then((enrollment) => {
          console.log('Successfully enrolled admin user "admin"');
          return fabric_client.createUser(
              {username: 'admin',
                  mspid: 'org1',        // TODO: Replace hard coded data with connection profile data. 
                  cryptoContent: { privateKeyPEM: enrollment.key.toBytes(), signedCertPEM: enrollment.certificate }
              });
        }).then((user) => {
          admin_user = user;
          return fabric_client.setUserContext(admin_user);

        // The new admin user has been enrolled into the IBM cloud fabric using the connection profile. 
        
        }).catch((err) => {
          console.error('\n\n Failed to enroll and persist admim. Error: ' + err.stack ? err.stack : err);
          throw new Error('\n\n Failed to enroll admin');
        });
    }
}).then(() => {
    console.log('Assigned the admin user to the fabric client ::' + admin_user.toString());
}).catch((err) => {
    console.error('Failed to enroll admin: ' + err);
});