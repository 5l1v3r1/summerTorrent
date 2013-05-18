var bencode = require('./bencode'), cryptolib = require('crypto');
filestore = require('./filestore'), fs = require('fs'), listener = require('./listener'), peer = require('./peer'), util = require('util'), tracker = require("./tracker");

function create(torrentPath, destDir){
    return {
        torrentPath: torrentPath,
        destDir: destDir,
        listenerPort: 6881+Math.floor(10*Math.random()),
        peerId: ('-JS0001-' + Math.random().toString(36).substr(3) +
        Math.random().toString(36).substr(3)).substr(0, 20),
        peers: {},
        store: {},
        downloading: {},
        metaInfo: {},
        piecesQueue: {},
        pingTracker: function(){
            var that = this, params = {
                info_hash: this.metaInfo.info_hash,
                peer_id: this.peerId,
                port: this.listenerPort,
                uploaded: 0,
                downloaded: 0,
                numwant: 50,
                left: this.store.left,
                compact: 1,
                event: 'started'
            };
            tracker.ping(this.trackerClient, params, function(error, response){
                var newPeers, numPeers, i, interval = 3600;
                if (!error) {
                    interval = Math.max(interval, response.interval);
                    util.puts(JSON.stringify(response))
                    newPeers = response.peers;

                    numPeers = Math.floor(newPeers.length / 6);
                    util.log('Tracker gave us ' + numPeers + ' peers.');
                    for (i = 0; i < numPeers; i++) {
                        that.addPeer(newPeers.substring(i * 6, (i + 1) * 6));
                    }
                }
                that.pingTimer = setTimeout(function(){
                    that.pingTracker();
                }, interval * 1000);
            });
        },

        addPeer: function(peerAddress){
            if (!(peerAddress in this.peers)) {
                try {
                    this.peers[peerAddress] = peer.create(peerAddress, this.decodeHost(peerAddress), this.decodePort(peerAddress), this);
                }
                catch (e) {
                    util.log('Exception while creating peer ' + e);
                }
            }
        },

        removePeer: function(peerAddress){
            var peer = this.peers[peerAddress];
            if (peer) {
                util.log('Removing peer ' + peer.host);
                delete this.peers[peerAddress];
            }
        },

        computeHash: function(info){
            var encoded = bencode.encode(info), hash = cryptolib.createHash('sha1');
            hash.update(encoded);
            return hash.digest('binary');
        },

        decodeHost: function(address){
            return address.charCodeAt(0) + '.' + address.charCodeAt(1) + '.' + address.charCodeAt(2) + '.' + address.charCodeAt(3);
        },

        decodePort: function(address){
            return (address.charCodeAt(4) << 8) + address.charCodeAt(5);
        },

        start: function(){
            var that = this;
            util.puts('Starting torrent ' + this.torrentPath);
            fs.readFile(this.torrentPath, 'binary', function startTorrentCallback(error, contents){
                if (error) {
                    util.log('Could not open torrent file ' + that.torrentPath + ': ' + error);
                }
                else {
                    that.metaInfo = bencode.decode(contents);
                    if ('comment' in that.metaInfo) {
                        util.log('Torrent \'' + that.metaInfo.comment + '\'');
                    }
                    that.metaInfo.info_hash = that.computeHash(that.metaInfo.info);
                    that.store = filestore.create(that.metaInfo, that.destDir);
                    util.log('inspecting files');
                    filestore.inspect(that.store, function inspectCallback(error){
                        if (error) {
                            util.log('Could not inspect torrent files ' + error);
                        }
                        else {
                            util.log('finished inspecting files.');
                            listener.create(that.listenerPort, that);
                            that.trackerClient = tracker.create(that.metaInfo);
                            that.pingTracker();

                            setInterval(function(){


                                //hey why not do a totally unoptimized super duper crappy whatnot
                                var pieces = { //piece_index: number_of_peers_have_it
};

                                /* Find all the pieces that the peers have */
                                for (var i in that.peers) { //iterate through peers,
                                    that.peers[i].getBitfield().getBitArray().forEach(function(val, index){ //loop through their bitfield
                                        pieces[index] = (pieces[index] || 0) + (+val); //add it to a map of pieces (since zero = dont have, 1 = have, adding works)
                                    })
                                }

                                // Delete any pieces that are in request queue
                                // & Purge pieces queue of any pieces > 120 seconds after requested not recieved.
                                for (i in that.piecesQueue) {
                                    if (that.piecesQueue[i] < (new Date().getTime() - 15 * 1000)) {

                                        delete that.piecesQueue[i];

                                        for (j in that.peers) {

                                            var piecelength = (i == that.store.pieceCount - 1) ? that.store.lastPieceLength : that.store.pieceLength;

                                            for (var start = 0; start < piecelength; start += Math.pow(2, 15)) {
                                                var peer = that.peers[j];
                                                if (peer) {
                                                    peer.sendCancel(i, start, ((start + Math.pow(2, 15)) <= piecelength ? Math.pow(2, 15) : (piecelength - start)));
                                                }
                                            }
                                        }

                                        util.log('Piece #' + i + ' timed out');

                                    }
                                    delete pieces[i];
                                };


                                var pieces_array = [];
                                that.store.goodPieces.getBitArray().forEach(function(v, i){ //loop through my bitfield
                                    if (v == 0 && pieces[i]) {
                                        //util.log('piece index: '+i+' == i no haz');
                                        pieces_array.push(i); //if I don't have it, and somebody else haz it, then add the index to pieces array
                                    }
                                    else
                                        if (v == 1) {
                                            delete that.piecesQueue[i];
                                        //util.log('piece index: '+i+' == i haz');
                                        }
                                });


                                pieces_array.sort(function(a, b){
                                    return pieces[a] - pieces[b]; //sort the pieces that I don't have by the number of people who have it
                                });

                                //pieces array now contains a list of pieces where 0 = rarest (and if there's only one peer, then it's sorted numerically)
                                //util.log('Pieces sorted by availability (rarest first). '+pieces_array.join(', '));

                                /*
                                 if(Object.size(that.piecesQueue) > 100) { // Only have 50 pieces requested at the same time?
                                 util.log('Limiting queue to 100 requests');
                                 return;
                                 }
                                 */
                                //util.log('Pieces sorted by availability (rarest first). ('+pieces_array.length+') :'+pieces_array.join(', '));

                                var peers_random = [];
                                for (i in that.peers) {
                                    peers_random.push(that.peers[i]);
                                }
                                peers_random.sort(function(){
                                    return Math.random() - .5; //TODO: replace with fisher yates knuth
                                });

                                //[pieces_array[0]].forEach(function(val, index) {
                                pieces_array.slice(0, 5).forEach(function(val, index){
                                    for (i = 0; i < peers_random.length; i++) { // Crude non-even shuffling algorithm
                                        if (peers_random[i].getBitfield().getBitArray()[val] && !peers_random[i].peerChoked && !that.piecesQueue[val]) {

                                            peers_random[i].setInterested(true);
                                            peers_random[i].setChoke(false);

                                            var piecelength = (val == that.store.pieceCount - 1) ? that.store.lastPieceLength : that.store.pieceLength;

                                            for (var start = 0; start < piecelength; start += Math.pow(2, 15)) {
                                                peers_random[i].sendRequest(val, start, ((start + Math.pow(2, 15)) <= piecelength ? Math.pow(2, 15) : (piecelength - start)));
                                                // Too verbose
                                                //util.log('requesting ('+[val, start, ((start+Math.pow(2,15)) <= piecelength ? Math.pow(2,15) : (piecelength-start))].join(', ')+')');

                                            }

                                            // Add piece to the list of pieces that are being queued.
                                            that.piecesQueue[val] = new Date().getTime();

                                            util.log('requested for part ' + val + ' from ' + peers_random[i].host);
                                            break;
                                        }
                                    }
                                });

                                var gotParts = that.store.goodPieces.getBitArray().filter(function(val){
                                    return val == '1';
                                }).length;
                                var totalParts = that.store.pieceCount


                                util.log(gotParts + "/" + totalParts + " Recieved  (" + (Math.floor((gotParts / totalParts) * 100 * 100) / 100) + "%)");



                                /* SEND REQUESTS TO PEERS HERE */

                                var request;

                                for (i in that.peers) {
                                    for (j = 0, peer = that.peers[i]; j < peer.requests.length; j++) {
                                        request = peer.requests[j];
                                        if (that.store.goodPieces.getBitArray()[request.index] == '1') {
                                            filestore.readPiecePart(that.store, request.index, request.begin, request.length, function(err, data){
                                                if (err) {
                                                    util.log('Error Reading Piece Part to send to peer');
                                                }
                                                else {
                                                    peer.sendPiece(request.index, request.begin, data);
                                                    util.log('Successfully sent piece ' + request.index + ' to ' + peer.host);
                                                }
                                            });
                                        }
                                        else {
                                            util.log('Peer requested for part ' + request.index + ', but I do not have it.');
                                        }
                                    }
                                    peer.requests = [];
                                }

                                util.log('# of peers: ' + Object.size(that.peers));

                            }, 500);

                            setInterval(function(){
                                util.log('Sent keepalives');
                                for (var i in that.peers) {
                                    that.peers[i].sendKeepalive();
                                }
                            }, 30000);

                        }
                    });
                }
            });
        }
    };
}

exports.create = create;
