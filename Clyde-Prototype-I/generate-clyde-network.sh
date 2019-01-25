#!/bin/bash

export FABRIC_CFG_PATH=$PWD
export CHANNEL_NAME=clyde-channel
export COMPOSE_PROJECT_NAME=Clyde-Sensor-Mesh
export IMAGETAG=latest 

if [ -e "channel-artifacts" ]; then
    ./cleanup.sh
    mkdir channel-artifacts
else
    mkdir channel-artifacts
fi

if [ -e "crypto-config.yaml" ]; then 
    cryptogen generate --config=crypto-config.yaml
else
    echo " ERROR:  Cannot find a crypto-config.yaml file. "
fi

configtxgen -profile Clyde-Hotel-Profile -outputBlock ./channel-artifacts/genesis.block
configtxgen -profile Clyde-Channel -outputCreateChannelTx ./channel-artifacts/channel.tx -channelID $CHANNEL_NAME
configtxgen -profile Clyde-Channel -outputAnchorPeersUpdate ./channel-artifacts/Producer-anchors.tx -channelID $CHANNEL_NAME -asOrg Producer
configtxgen -profile Clyde-Channel -outputAnchorPeersUpdate ./channel-artifacts/Consumer-anchors.tx -channelID $CHANNEL_NAME -asOrg Consumer

# This is overkill but for now we run only the one set of docker images.
docker kill $(docker ps -aq); docker rm $(docker ps -aq)

