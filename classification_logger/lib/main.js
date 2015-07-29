//Extension to log classifier performance

/////////////logger specific imports

var {Cu, Cc, Ci, components} = require('chrome') //main components
var foStream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream); //file output stream
var converter = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream); //text encoder
Cu.import("resource://gre/modules/FileUtils.jsm"); //file utilities
var file = FileUtils.getFile("Desk", ['classification_log.txt'])

function write_to_log(some_data){
	//writes some text to the log file
	//let ext_version = 0.1
	
	let timestamp = Cu.now() //timestamp it
	let to_write = [version,timestamp,some_data].join('###') + "\n"
	foStream.init(file, 0x02 | 0x08 | 0x10, 0777, 0); //open file for appending
	converter.init(foStream, "UTF-8", 0, 0); //convert to UTF8
	converter.writeString(to_write);
	converter.close(); // this also closes foStream
}

/////////////classification specific imports

var t0 = Cu.now();
var pageMod = require("sdk/page-mod");
var {data, version} = require('sdk/self');
var tabs = require('sdk/tabs');
Cu.import("resource://gre/modules/NetUtil.jsm");
var t1 = Cu.now();
write_to_log("component_import_time:" + (t1 - t0) + " ms")

//test loading the classifier
t0 = Cu.now(); var {LICA} = require('./classifier_LICA'); t1 = Cu.now();
write_to_log("classifier_import_time:" + (t1 - t0) + " ms")

//test setting up the classifier
t0 = Cu.now(); var lica = new LICA(); t1 = Cu.now();
write_to_log("classifier_setup_time:" + (t1 - t0) + " ms")

//simple pagemod to grab current tab url after the page has loaded
pageMod.PageMod({
	include: ["*"],
	contentScriptFile: data.url("logger_worker.js"),
	onAttach: function(worker) {
		
		//request the page details
		worker.port.emit("get_info");
		
		//classify the url and log the performance+result
		worker.port.on("got_info", function(info) {
			process_info(info)
		});
	},
	attachTo: ["existing", "top"],
	contentScriptWhen: "end"
});


//functionality

function process_info(info) {
	//tests classification timings and logs performance
	//appends the following to a text file
	//(optional url), classification, # of tabs open, loading time, classification time, classification type
	
	let stats = {} //container for metrics
	let url = info
	stats['tabs_open'] = tabs.length
	
	//classify inputted urls
	t0 = Cu.now(); let result = lica.classify(url); t1 = Cu.now()
	stats['classification_time'] = (t1-t0) + " ms"
	stats['classification_result'] = result //includes classification type
	
	//serialize and write to file
	data = JSON.stringify(stats)
	write_to_log(data)
	console.log(data)
}
