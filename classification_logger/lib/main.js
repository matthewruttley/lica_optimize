//Extension to log classifier performance

//imports
var {Cu, Cc, Ci, components} = require('chrome') //can't log this
var t0 = Cu.now();
var pageMod = require("sdk/page-mod");
var {data} = require('sdk/self')
var tabs = require('sdk/tabs');
Cu.import("resource://gre/modules/FileUtils.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");

let file = new FileUtils.File("~/Desktop/classification_logger.txt");
var foStream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
var converter = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);

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
	contentScriptWhen: "end"
});


//functionality

function write_to_log(data){
	//timestamp it
	timestamp = Cu.now() + "###"
	toWrite = timestamp + data + "\n"
	
	// use 0x02 | 0x10 to open file for appending.
	foStream.init(file, 0x02 | 0x10, 0666, 0); 
	
	converter.init(foStream, "UTF-8", 0, 0);
	converter.writeString(toWrite);
	converter.close(); // this closes foStream
}

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
