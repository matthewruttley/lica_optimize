//test out LICA

//First import and load LICA
var {LICA} = require('./classifier_LICA_v0.2')
var lica = new LICA()

//testing payload
tests = [
	//General types of classification
	{
		'name': "Keyword classification",
		'url': 'http://www.coinweek.com/us-coins/the-marvelous-pogue-family-coin-collection-part-2-the-oliver-jung-1833-half-dime/',
		'expected_result': ['hobbies & interests', 'coins', 'keyword_matching']
	},
	{
		'name': "Single topic TLD",
		'url': 'http://taste.com.au',
		'expected_result': ["food & drink","cooking","single_topic_site"]
	},
	{
		'name': "Single topic subdomain",
		'url': 'http://soccerblog.dallasnews.com',
		'expected_result': ['sports', 'soccer', 'single_topic_subdomain']
	},
	{
		'name': "Single topic path",
		'url': 'http://csmonitor.com/In-Gear',
		'expected_result': ['automotive', 'general', 'single_topic_path']
	},
	{
		'name': "Single topic extended path",
		'url': 'http://csmonitor.com/In-Gear/matthew',
		'expected_result': ['automotive', 'general', 'single_topic_path']
	},
	{
		'name': "Single topic extended path with subdomain",
		'url': 'http://something.csmonitor.com/In-Gear/something.html',
		'expected_result': ['automotive', 'general', 'single_topic_path']
	},
	//validation
	{
		'name': "Local URL",
		'url': 'http://localhost:5000/',
		'expected_result': ["uncategorized","invalid_url","nsi_error"]
	},
	{
		'name': "Invalid URL",
		'url': 'ftp://-1.-1.-1.-1/',
		'expected_result': ["uncategorized","invalid_url","nsi_error"]
	},
	{
		'name': "No protocol URL",
		'url': 'something.something.com',
		'expected_result': ["uncategorized","unknown","keyword_matching"]
	}
]

exports["test classification results"] = function(assert) {
	for (let test of tests) {
		result = lica.classify(test.url)
		
		//diagnostics
		//if (JSON.stringify(result) == JSON.stringify(test.expected_result)) {validity='valid'}else{validity='invalid'}
		//console.log('expected: ' + test.expected_result + " and got " + result + " which is " + validity)
		
		assert.ok(JSON.stringify(result) == JSON.stringify(test.expected_result), test.name);
	}
}


function onSuccess() {
	require("sdk/test").run(exports);
}


