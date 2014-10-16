require("nodetime").profile({
	accountKey: '469f144b0de2d761e04c6a887858b6c30c867cb0', 
	appName: 'voidpirates'
});
// Import node modules. These are contained in the node_modules directory.
var dissolve = require("dissolve"),
    events = require("events"),
    WebSocketServer = require("ws").Server;
// Server constants (settings)
var version = 1; // Protocol version
// Arrays of various game objects
var players = [];
// Event emitter
var eventEmitter = new events.EventEmitter();

// Simplify event listening
exports.on = function(eventName, callback) {
	eventEmitter.on(eventName, callback);
};

// Start server..
exports.start = function(port) {
	// Create a new web socket server on port 1337
	var wss = new WebSocketServer({ port: port });

	// This event fires when we receive a new connection
	// All of the code in this function applies to the newly connected user.
	wss.on("connection", function(socket) {
		socket.remoteAddress = socket._socket.remoteAddress;
		console.log("Client connection from: " + socket.remoteAddress);
		// Add the new connection to the player array
		// TODO Make sure the assigned ID isn't already in the players array
    players.push({
    	socket: socket,
	    ip: socket.host,
      id: Math.floor(Math.random() * 255),
			x: Math.floor(Math.random() * 800),
			y: Math.floor(Math.random() * 600),
			rx: 0.0,
			ry: 0.0,
			actor: {
				actorID: 0,
				actorType: "Spaceship",
				x: 0,
				y: 0,
			},
			pong: false,
			kicked: false,
			timedout: false,
			moved: false,
			commands: []
        	});
		// This event fires when we receive data on the socket
		socket.on("message", function(data) {
			// Now we need to parse the incoming packet
			// TODO Add some method to make sure the incoming packet isn't
			// too large
			if (data.length === 0) { return; }
			var player = getPlayer(socket);
			switch (data[0]) {
				case 0x00: 
					if (data[1] != version) { // Client expecting different protocol
           	console.log(socket.remoteAddress + " bad protocol version");
           	// Send Error packet (error 0)
            sendError(player, 0x00);
          	break;
          }
          if (data[2] === 0) {
            // Client needs ID
         		// Send the client their automatically assigned id
            sendUint8Packet(socket, new Uint8Array([0x00,player.id]));
           	data[2] = player.id;
          } else if (data[2] !== 0) {
           	// Make sure the requested ID is not in use
           	if (checkDuplicateID(data[2])) {
            	// Send new ID
              sendUint8Packet(socket, new Uint8Array([0x00,player.id]));
            } else {
              	// Client-requested ID is good
              	sendUint8Packet(socket, new Uint8Array([0x00,data[2]]));
            }
        	}
         	// Now, spawn the player in the game.
          player.id = data[2];
          // Fire player.connected event
          eventEmitter.emit("player.connected", player);

          // Send spawn packet for just the player
          sendSpawnPacket(player, player);
          // Spawn existing players for the new player.
          // This also notifies existing players of the new player.
         	spawnExisting(player);
          // New player is spawned, fire player.spawnNewPlayer event
          eventEmitter.emit("player.spawnNewPlayer", player);
					break;
			  case 0x01: 
					player.pong = true;
					break;
			  case 0x02: 
					player.moved = true;
					if (data[1] === 1 && data[2] === 0) {
          	// Move left
            eventEmitter.emit("player.positionChange", {direction:"left",player:player});
           } else if (data[1] === 2 && data[2] === 0) {
             // Move right
             eventEmitter.emit("player.positionChange", {direction:"right",player:player});
           } else if (data[1] === 0 && data[2] === 1) {
             // Move up
             eventEmitter.emit("player.positionChange", {direction:"up",player:player});
           } else if (data[1] === 0 && data[2] === 2) {
             // Move down
             eventEmitter.emit("player.positionChange", {direction:"down",player:player});
           }
					break;
			}
		});
		// Ping this player every 20 seconds
		var interval = setInterval(function() {
			ping(getPlayer(socket));
		}, 20000);
		socket.on("close", function(e) {
			console.log("Client disconnected");
			var player = getPlayer(socket);
			eventEmitter.emit("player.disconnection", player);
			// Remove the player from the players array
			removePlayer(socket);
			// Notify all other players of quit event
			for (var i = 0; i < players.length; i++) {
				// Clean exit
				if (!player.kick && !player.timedout) {
					sendUint8Packet(players[i].socket, new Uint8Array([0x05, player.id, 0x00]));
				} else if (player.timedout) { // Timed out
					sendUint8Packet(players[i].socket, new Uint8Array([0x05, player.id, 0x01]));
				} else if (player.kicked) { // Kicked
					sendUint8Packet(players[i].socket, new Uint8Array([0x05, player.id, 0x02]));
				}
			}
			// Stop pinging.
			clearInterval(interval);
		});
	});
};




			

// ====== Update World Data  ======

// This function loops through all players and processes any pending commands.
function processPlayerCommands() {
	for (var i = 0; i < players.length; i++) {
		var commands = players[i].commands;
		for (var j = 0; j < commands.length; j++) {
			var e = commands[j];
			var player = players[i];
			// Process Position Changes
			if (e.pkid == 0x02) {
				sendPositionUpdates();
			}
		}
		commands.length = 0;
	}
}
exports.sendPositionUpdates = function(player) {
	// player = the player that moved.
		for (var i = 0; i < players.length; i++) {
			for (var j = 0; j < players.length; j++) {
				if (players[i].socket.readyState != 2 && players[j].moved) {
					sendPositionPacket(players[i], players[j]);
				}
			}
		}	 
		player.moved = false;
};
/*
 * function mainLoop() {
 * 	setInterval(function () {
 * 		processPlayerCommands();
 * 		//sendPositionUpdates();
 * 	}, 1000/60);
 * }
 * mainLoop();
 */

// ========================


// This function pings the specified player
// The client must respond to this message within 3 seconds
// Arguments:
//	(Player) player = The player to send the ping to.
function ping(player) {
	sendUint8Packet(player.socket, new Uint8Array([0x01, Math.floor(Math.random() * 255)]));
	setTimeout(function() {
		if (!player.pong) {
			player.timedout = true;
			console.log(player.socket.remoteAddress + " ping timeout");
			player.socket.terminate();
		} else {
			player.pong = false;
		}
	}, 3000);	
}
// This function sends existing players' locations to a new player.
// Also, this function notifies each existing player of the new player.
// Arguments:
//	(Player) newPlayer = The new player.
function spawnExisting(newPlayer) {
	for (var i = 0; i < players.length; i++) {
		var currentPlayer = players[i];
		if (currentPlayer.id != newPlayer.id) {
			console.log("spawn existing player");
			// Existing player spawn for new player
			sendSpawnPacket(newPlayer, currentPlayer);
	
			// New player spawn for existing player
			sendSpawnPacket(currentPlayer, newPlayer);
		}
	}
}

// This function checks to see if a player ID is already in use
// Arguments:
//	(uint8) id = The player ID to check
function checkDuplicateID(id) {
	for (var i = 0; i < players.length; i++) {
		if (players[i].id == id) {
			return true;
		}
	}
	return false;
}

// This function sends a packet of unsigned 8-bit integers
// Arguments:
//	(Socket) socket = The socket to send the packet to
//	(Uint8Array) p = The array of unsigned 8-bit integers 
function sendUint8Packet(socket, p) {
	var buffer = new ArrayBuffer(p.length);
	var packet = new Uint8Array(buffer);
	for (var i = 0; i < p.length; i++) {
		packet[i] = p[i];
	}
	socket.send(buffer);
}

// This function sends a spawn packet to the specified player
// Arguments:
//	(Player) targetPlayer = The player to send the packet to
//	(Player) player = The player that spawned.
function sendSpawnPacket(targetPlayer, player) {
	var buffer = new ArrayBuffer(20);
	var b1 = new Uint8Array(buffer, 0, 3);
	b1[0] = 0x03; // Packet ID
	b1[1] = player.id;
	b1[2] = player.spriteID;
	var b2 = new Float32Array(buffer, 4);
	b2[0] = player.x;
	b2[1] = player.y;
	b2[2] = player.rx;
	b2[3] = player.ry;
	targetPlayer.socket.send(buffer);
}

// This function sends a position update packet to the specified player.
// Arguments:
//	(Player) targetPlayer = The player to send the packet to
//	(Player) player = The player whose position changed
function sendPositionPacket(targetPlayer, player) {
	var buffer = new ArrayBuffer(20);
	var b1 = new Uint8Array(buffer, 0, 3);
	b1[0] = 0x04; // Packet ID
	b1[1] = player.id;
	b1[2] = player.spriteID;
	var b2 = new Float32Array(buffer, 4);
	b2[0] = player.x;
	b2[1] = player.y;
	b2[2] = player.rx;
	b2[3] = player.ry;
	targetPlayer.socket.send(buffer);	
}

// This function sends an error to the player.
// This packet should not be sent unless it is impossible to recover from this error
// Arguments:
//	(Player) player = The player to send the error to
//	(uint8) error = The error code 
function sendErrorPacket(player, error) {
	sendUint8Packet(player.socket, new Uint8Array([0xFF, error]));
	player.socket.terminate();
}

// Remove the Player object that corresponds with the given socket.
// Arguments:
//	(Socket) socket = The socket of the player to remove.
function removePlayer(socket) {
	players.splice(players.indexOf(getPlayer(socket)), 1);
}

// Return the Player object that corresponds with the given socket.
// Arguments:
//	(Socket) socket = The socket of the target player.
function getPlayer(socket) {
	for (var i = 0; i < players.length; i++) {
		if (players[i].socket == socket) {
			return players[i];
		}
	}
}
