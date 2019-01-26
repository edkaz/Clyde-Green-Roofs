var Fabric_Client    = require('fabric-client');
var Fabric_CA_Client = require('fabric-ca-client');

var path             = require('path');
var util             = require('util');
var os               = require('os');
// 

var fabric_client    = null;
var fabric_ca_client = null;
var admin_user       = null;
var member_user      = null;
var store_path       = path.join(__dirname, 'hfc-key-store');
var	tlsOptions = {
                    trustedRoots: [],
                    verify: false
                };

var fabric_client = new Fabric_Client();

Fabric_Client.newDefaultKeyValueStore({ path: store_path
}).then((state_store) => {
// Step 1 - Assign the store to the fabric client
fabric_client.setStateStore(state_store);
var crypto_suite = Fabric_Client.newCryptoSuite();
// use the same location for the state store (where the users' certificate are kept)
// and the crypto store (where the users' keys are kept)
var crypto_store = Fabric_Client.newCryptoKeyStore({path: store_path});
crypto_suite.setCryptoKeyStore(crypto_store);
fabric_client.setCryptoSuite(crypto_suite);
