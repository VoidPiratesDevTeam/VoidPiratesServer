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
			commands: []
        	});
		// This event fires when we receive data on the socket
		socket.on("message", function(data) {
			// Now we need to parse the incoming packet
			// TODO Add some method to make sure the incoming packet isn't
			// too large
			var parser = dissolve().loop(function(end) {
				var goodPacket = true;
				this.uint8("pkid").tap(function() {
					// This essentially formats a JS object that will contain 
					// all incoming packets. Only formatting code should go here.
					switch (this.vars.pkid) {
						case 0x00: this.uint8("protocol").uint8("playerid"); break;
						case 0x01: break;
						case 0x02: this.uint8("directionX").uint8("directionY"); break;
						default:
							// we don't understand the packet
							console.log(socket.remoteAddress + " invalid packet");
							goodPacket = false;
							socket.terminate();
					}
				}).tap (function() { if (goodPacket) {
					this.push(this.vars);
					this.vars = {};
				}});
			});
			// This event fires when the parser has finished interpreting all data
			// We can now access the data it parsed in an easier way.
			parser.on("readable", function() {
				var e;
				while (e = parser.read()) {
					// Uncomment line below to view each incoming packet.
					//console.log(e);
					// Now we actually apply an action to each incoming packet.
					var player = getPlayer(socket);
					switch (e.pkid) {
						case 0x00:
							if (e.protocol != version) { // Client expecting different protocol
								console.log(socket.remoteAddress + " bad protocol version");
								// Send Error packet (error 0)
								sendError(player, 0x00);
								break;
							}
							if (e.playerid == 0) { 
								// Client needs ID
								// Send the client their automatically assigned id
								sendUint8Packet(socket, new Uint8Array([0x00,player.id]));
								e.playerid = player.id
							} else if (e.playerid != 0) {
								// Make sure the requested ID is not in use
								if (checkDuplicateID(e.playerid)) {
									// Send new ID
									sendUint8Packet(socket, new Uint8Array([0x00,player.id]));
								} else {
									// Client-requested ID is good
									sendUint8Packet(socket, new Uint8Array([0x00,e.playerid]));
								}
							}
							// Now, spawn the player in the game.
							player.id = e.playerid;
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
						case 0x02: // Client Position Update
							player.commands.push(e);
							break;
					}
				}
			});
			// Write incoming packet to parser
			parser.write(data);
		});
		// Ping this player every 20 seconds
		var interval = setInterval(function() {
			ping(getPlayer(socket));
		}, 20000);
		socket.on("close", function(e) {
			console.log("Client disconnected");
			var player = getPlayer(socket);
			eventEmitter.emit("player.disconnected", player);
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
				if (e.directionX == 1 && e.directionY == 0) { 
					// Move left
					//players[i].x -= 8;
					eventEmitter.emit("player.positionChange", {direction:"left",player:player});
				} else if (e.directionX == 2 && e.directionY == 0) {
					// Move right
					//players[i].x += 8;
					eventEmitter.emit("player.positionChange", {direction:"right",player:player});
				} else if (e.directionX == 0 && e.directionY == 1) {
					// Move up
					//players[i].y += 8; 
					eventEmitter.emit("player.positionChange", {direction:"up",player:player});
				} else if (e.directionX == 0 && e.directionY == 2) {
					// Move down
					//players[i].y -= 8;
					eventEmitter.emit("player.positionChange", {direction:"down",player:player});
				}
			}
		}
		commands.length = 0;
	}
}
function sendPositionUpdates() {
		for (var i = 0; i < players.length; i++) {
			for (var j = 0; j < players.length; j++) {
				if (players[i].socket.readyState != 2) {
					sendPositionPacket(players[i], players[j]);
				}
			}
		}	 
}
function mainLoop() {
	setInterval(function () {
		processPlayerCommands();
		sendPositionUpdates();
	}, 1000/60);
}
mainLoop();

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
