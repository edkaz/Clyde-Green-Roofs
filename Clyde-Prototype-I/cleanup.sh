#!/bin/bash

if [ -e "crypto-config" ]; then
    echo "Removing crypto-config ... "
    /bin/rm -fr crypto-config
fi

if [ -e "channel-artifacts" ]; then 
    echo "Removing channel-artifacts ... "
    rm -fr channel-artifacts
fi