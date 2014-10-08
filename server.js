var voidpirates = require("./voidpirates.js");

// This will start a basic server that handles connections and accepts packet data it understands
// All other functionality must be added on.

// Events

// Player Events
voidpirates.on("player.connected", function(player) {
	console.log("Player connected event");
});

voidpirates.on("player.disconnected", function(player) {
	console.log("Player disconnected event");
});

voidpirates.on("player.positionChange", function(evt) {
	if (evt.direction === "left") {
		evt.player.x -= 8;
	} else if (evt.direction === "right") {
		evt.player.x += 8;
	} else if (evt.direction === "up") {
		evt.player.y += 8;
	} else if (evt.direction === "down") {
		evt.player.y -= 8;
	}	
});

voidpirates.on("player.spawnNewPlayer", function(player) {
	console.log("Spawned new player event");
});

// Start server on port 1337
voidpirates.start(1337);
