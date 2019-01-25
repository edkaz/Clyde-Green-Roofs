configtxgen -configPath "./" -profile ClydeHotel -outputBlock ./channel-artifacts/genesis.block
export CHANNEL_NAME="sensor-network"  && configtxgen -profile ClydeChannel -outputCreateChannelTx ./channel-artifacts/channel.tx -channelID $CHANNEL_NAME
