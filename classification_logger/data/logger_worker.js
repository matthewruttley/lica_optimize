//worker to grab the url and other details when each page is visited

///////Message passing

self.port.on("get_info", function(stats) {
	let url = get_url()	
	self.port.emit("got_info", url)
});


///////Functionality

function get_url(){
	return window.location.href
}