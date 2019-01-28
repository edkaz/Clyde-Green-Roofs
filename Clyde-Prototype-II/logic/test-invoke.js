'use strict';

/*-----------------------------------------------------------------------------------------------
 *  Invoking a Transaction on the IBM Cloud fabric
 * 
 *  Adapted from the IBM fabcar example it requires the IBM cloud fabric's connection profile - 
 *  connection-profile.json - is a JSON object specifying the connection parameters. 
 * 
 *  Ed. Kazmierczak, Dec. 2018.
 * 
 *---------------------------------------------------------------------------------------------*/

var Fabric_Client  = require('fabric-client');
var path           = require('path');
var util           = require('util');
var os             = require('os');
var credentials    = require('./connection-profile.json')

//---------- Initialisation -------------------------------------------------------------------

var channelName    = 'defaultchannel';
var peerURL        = credentials.peers["org1-peer1"].url;
var peerPEM        = credentials.peers["org1-peer1"].tlsCACerts.pem;
var ordererURL     = credentials.orderers.orderer.url;
var ordererPEM     = credentials.orderers.orderer.tlsCACerts.pem

var fabric_client = new Fabric_Client();

/*---------- Create the Network and the Channel -----------------------------------------------
 *  Step 1 - Is to create objects to access to the channel, orderers, and peers of the IBM 
 *  cloud fabric that we've created. 
 */

var channel       = fabric_client.newChannel(channelName);
var orderer       = fabric_client.newOrderer(ordererURL, { pem: ordererPEM, 'ssl-target-name-override': null});
// channel.addOrderer(orderer);
var peer          = fabric_client.newPeer(peerURL, { pem: peerPEM , 'ssl-target-name-override': null});
// channel.addPeer(peer);

/*---------- A User Sends a new Transaction to the Blockchain -----------------------------------
 *  Step 2 - A registered user sends a transaction to the blockchain. Transactions to the 
  * must be proposed and signed by the proposer. To do this a valid user is required with their
  * X.509 certificates. So now we will get ourselves a user ...
 */

var member_user = null;
var store_path  = path.join(__dirname, 'hfc-key-store');
var tx_id       = null;
console.log('Store path:' + store_path);

/*---------- Create the key value store -------------------------------------------------------
 *  Create the key-value store as defined in the fabric-client/config/default.json and access
 *  it to add an 'admin' user and an ordinary 'user'
 */

Fabric_Client.newDefaultKeyValueStore({ path: store_path
}).then((state_store) => {

	fabric_client.setStateStore(state_store);

	var crypto_suite = Fabric_Client.newCryptoSuite();
	var crypto_store = Fabric_Client.newCryptoKeyStore({path: store_path});

	crypto_suite.setCryptoKeyStore(crypto_store);
	fabric_client.setCryptoSuite(crypto_suite);

	return fabric_client.getUserContext('user-one', true);
}).then((user_from_store) => {

	if (user_from_store && user_from_store.isEnrolled()) {
		console.log('Successfully loaded user-one from persistence');
		member_user = user_from_store;
	} else {
		throw new Error('Failed to get user1 ... run registerUser.js');
	}

	// Step 2 - Obtain a transaction id object for the current user just assigned to fabric client.
	tx_id = fabric_client.newTransactionID();
	console.log("Assigning transaction_id: ", tx_id._transaction_id);

	// The request is for a new temperature reading transaction to execute. The arguments for the transaction are 
	var request = {
		            //targets: let default to the peer assigned to the client
		            chaincodeId: 'clyde-prototype',
		            fcn: 'temperatureReading',
					args: [' { "SD": { "SensorName": "3020022H", "Latitude": 0.0, "Longitude": 0.0, "TimeStampe": 0.0, "Temperature": 21.5}, "SR": []'],
		            chainId: 'defaultchannel',
					txId: tx_id  
	            };

	/* Send the transaction proposal to the peers and await a proposal response object 
	 * (https://fabric-sdk-node.github.io/global.html#ProposalResponseObject)
	 */ 
	return channel.sendTransactionProposal(request);
}).then((results) => {

	// Peer responses from peers are in results[0] and the original proposal object is in results[1].

	var proposalResponses = results[0];
	var proposal = results[1];

	let isProposalGood = false;
	if (proposalResponses && proposalResponses[0].response &&
		proposalResponses[0].response.status === 200) {
			isProposalGood = true;
			console.log('Transaction proposal was good');
		} else {
			console.error('Transaction proposal was bad');
		}

	if (isProposalGood) {
		console.log(util.format(
			'Successfully sent Proposal and received ProposalResponse: Status - %s, message - "%s"',
			proposalResponses[0].response.status, proposalResponses[0].response.message));

		// Step 3 - Create a request for the orderer to commit the transaction.
		var request = {
						proposalResponses: proposalResponses,
						proposal: proposal
					  };

		/*---------- Handling Time-Out Events -------------------------------------------------------------			  
		 *   If the transaction did not get committed within the timeout period (30s as set in the config)
		 *   report a TIMEOUT status. The TIMEOUT status will be a 'peer' event so we need to set up and 
		 *   register a TIMEOUT event for the peers.
		 */ 

		var transaction_id_string = tx_id.getTransactionID(); 
		var promises = [];

		var sendPromise = channel.sendTransaction(request);
		promises.push(sendPromise); 

		// Create an event-hub. The event_hub requires users to sign events so a user must have been
		// created and enrolled for events to be signed. 

		let event_hub = channel.newChannelEventHub(peer);
		// Timeout and event handling pretty much as in Fabcar.
		let txPromise = new Promise((resolve, reject) => {
			let handle = setTimeout(() => {
				event_hub.unregisterTxEvent(transaction_id_string);
				event_hub.disconnect();
				resolve({event_status : 'TIMEOUT'}); 
			}, 3000);
			event_hub.registerTxEvent(transaction_id_string, (tx, code) => {
				// this is the callback for transaction event status
				// first some clean up of event listener
				clearTimeout(handle);

				// now let the application know what happened
				var return_status = {event_status : code, tx_id : transaction_id_string};
				if (code !== 'VALID') {
					console.error('The transaction was invalid, code = ' + code);
					resolve(return_status); // we could use reject(new Error('Problem with the tranaction, event status ::'+code));
				} else {
					console.log('The transaction has been committed on peer ' + event_hub.getPeerAddr());
					resolve(return_status);
				}
			}, (err) => {
				//this is the callback if something goes wrong with the event registration or processing
				reject(new Error('There was a problem with the eventhub ::'+err));
			},
				{disconnect: true} //disconnect when complete
			);
			event_hub.connect();

		});
		promises.push(txPromise);

		return Promise.all(promises);
	} else {
		console.error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
		throw new Error('Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
	}
}).then((results) => {
	console.log('Send transaction promise and event listener promise have completed');
	// check the results in the order the promises were added to the promise all list
	if (results && results[0] && results[0].status === 'SUCCESS') {
		console.log('Successfully sent transaction to the orderer.');
	} else {
		console.error('Failed to order the transaction. Error code: ' + results[0].status);
	}

	if(results && results[1] && results[1].event_status === 'VALID') {
		console.log('Successfully committed the change to the ledger by the peer');
	} else {
		console.log('Transaction failed to be committed to the ledger due to ::'+results[1].event_status);
	}
}).catch((err) => {
	console.error('Failed to invoke successfully :: ' + err);
});
