// ----------- LICA -----------
//    Original: https://github.com/matthewruttley/mozclassify/blob/master/classifier_LICA.py
//      Author: mruttley
// Description: Javascript (FF Addon) port of Latent IAB Category Allocation (LICA).
//				Given a URL, it returns a top level and sub level category. 
// Usage:
//
// > lica = LICA()
// > lica.classify("http://www.coinweek.com/us-coins/the-marvelous-pogue-family-coin-collection-part-2-the-oliver-jung-1833-half-dime/")
// ['hobbies & interests', 'coins']
//
// Requires 4 payloads:
// - mozcat_heirarchy.json
//   --- Mozilla Content Service's custom interest taxonomy.
//   --- Master version: https://github.com/matthewruttley/mozcat/blob/master/mozcat_heirarchy.json
//
// - payload_domain_rules.json
//   --- a mapping of domains, subdomains and paths to categories in mozcat
//
// - payload_lica.json
//   --- a mapping of english words to categories
//
// - stopwords.json
//   --- A list of non-useful english words like a, the, and, but
//   --- Also web stopwords like account, login, password that we want to ignore 
//

//import firefox services
const {data} = require('sdk/self') //used to reference files in the /data folder
const {Cc, Ci} = require('chrome') //these next 3 used to parse URLs
let eTLDService = Cc["@mozilla.org/network/effective-tld-service;1"].getService(Ci.nsIEffectiveTLDService);
let ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService) 

//auxiliary functionality

function makeTree(levels, end){
	//Recursively builds a tree from a list
	//`levels` are levels you want to integrate, e.g. ['one', 'two', 'three']
	//`end` is the value of the end item e.g. 'test'
	//The result would be: {'one': {'two': {'three': 'test'}}}

	if (levels.length == 1) {
		let x = {}
		x[levels[0]] = end
		return x
	}else{
		let x = {}
		x[levels[0]] = makeTree(levels.slice(1, levels.length), end)
		return x
	}
}

function checkTree(levels, tree){
	//Recursively checks a tree similar to the one made above in make_tree()
	
	if (levels.length == 1) {
		if (tree.hasOwnProperty(levels[0])) {
			if (typeof(tree[levels[0]]) != "object") {
				return tree[levels[0]]
			}
		}
		return false
	}else{
		if (tree.hasOwnProperty(levels[0])) {
			return checkTree(levels.slice(1, levels.length), tree[levels[0]])
		}else{
			return false
		}
	}
	
}

function merge(a, b, path=false) {
	//merges object b into object a.
	//js port of: http://stackoverflow.com/a/7205107/849354
	
	if (path == false) {
		path = []
	}
	for(let key of Object.keys(b)){
		if (a.hasOwnProperty(key)) {
			if ((typeof(a) === "object") && (typeof(b) === "object")) {
				merge(a[key], b[key], path + [key.toString()])
			}else{
				if (a[key] == b[key]) {
					//pass
				}else{
					throw "Conflict!"
				}
			}
		}else{
			a[key] = b[key]
		}
	}
	return a
}

function parseURL(url){
	//Accepts a url e.g.: https://news.politics.bbc.co.uk/thing/something?whatever=1
	//returns a useful dictionary with the components
	
	//have to add scheme if not present or ioService throws an error
	if (url.substring(0,4) != 'http') {
		url = 'http://' + url
	}
	
	url = ioService.newURI(url,null,null)
	components = {}
	
	components.suffix = eTLDService.getPublicSuffix(url) //co.uk
	components.tld = eTLDService.getBaseDomain(url) //bbc.co.uk
	components.host = url.host.substring(0, url.host.length-components.tld.length-1) //news.politics
	components.path = url.path.split('?')[0].split('#')[0].substring(1) //thing/something

	return components

}

function intersect_safe(a, b){
	//http://stackoverflow.com/a/1885660/849354
	
	let ai = bi= 0;
	let result = [];
	
	while(ai < a.length && bi < b.length){
		if(a[ai] < b[bi]){
			ai++;
		}else if(a[ai] > b[bi]){
			bi++;
		}else{ /* they're equal */
			result.push(ai);
			ai++;
			bi++;
		}
	}
	return result;
}

function compareSecondColumn(a, b) {
	//http://stackoverflow.com/a/16097058/849354
    if (a[1] === b[1]) {
        return 0;
    }
    else {
        return (a[1] < b[1]) ? -1 : 1;
    }
}

//actual functionality

function LICA(){
    // Class that can classify a url using LICA.
    
    this.init = function() {
        //Sets up the classifier
		
		//import the main payload with lica's keyword mappings
		this.payload = JSON.parse(data.load("payload_lica.json"))
		
		//The payload is currently in the format: category: [kw, kw, kw]
		//It is kept in this format to make it easier to edit
		//Build a mapping in memory of the opposite: kw: category, kw: category
		this.positive_keywords = {}
		for (let top_level of Object.keys(this.payload.positive_words)) {
			let sub_level = this.payload.positive_words[top_level]
			for (let category of Object.keys(sub_level)) {
				keywords = sub_level[category]
				for (let keyword of keywords) {
					this.positive_keywords[keyword] = [top_level, category]
				}
			}
		}
		
		//create a stoplist object with words we aren't concerned with (e.g. and, but, the)
		//this is useful so we can focus on just the nouns that describe the topic
		this.stopwords = JSON.parse(data.load("stopwords.json"))
		for (let type of Object.keys(this.stopwords)){
			//convert each list to a {kw: true} mapping since the look-up time is faster
			tmpKeywords = {}
			for (let kw of this.stopwords[type]) {
				tmpKeywords[kw] = true
			}
			this.stopwords[type] = tmpKeywords
		}
		
		//import mozilla's taxonomy
		let mozcat = JSON.parse(data.load("mozcat_heirarchy.json"))
		//currently in the format: top_level: [sub_level, sub_level, ...]
		//lookups are faster if it is sub_level: [top_level, sub_level]
		this.taxonomy = {}
		for (let top_level of Object.keys(mozcat)) {
			this.taxonomy[top_level] = [top_level, "general"]
			for (let sub_level of mozcat[top_level]) {
				this.taxonomy[sub_level] = [top_level, sub_level]
			}
		}
		
		//import the single topic sites, single topic subdomains and single topic paths
		this.rules = JSON.parse(data.load("payload_domain_rules.json"))
		
		//import domain rules and point them to [top_level, sub_level] pairs made previously
		for (let domain of Object.keys(this.rules.domain_rules)) {
			this.rules.domain_rules[domain] = this.taxonomy[this.rules.domain_rules[domain]]
		}
		
		//convert the host rules into an easily searchable format
		// from: 	"au.movies.yahoo.com": "television",
		// 	 to:	"yahoo.com": { 'movies': { 'au': ['arts & entertainment', 'television'] } }
		
		let tmp_host_rules = {} //store them temporarily here then fill out the object
		for (let host_rule of Object.keys(this.rules.host_rules)) {
			let category = this.taxonomy[this.rules.host_rules[host_rule]]
			let components = parseURL(host_rule)
			let tree = makeTree(components.host.split('.').reverse(), category)
			let x = {}
			x[components.tld] = tree
			merge(tmp_host_rules, x)
		}
		this.rules.host_rules = tmp_host_rules
		
		//convert the path rules into an easily searchable format
		let tmp_path_rules = {}
		for (let path_rule of Object.keys(this.rules.path_rules)) {
			let category = this.taxonomy[this.rules.path_rules[path_rule]]
			let components = parseURL(path_rule)
			let path = components.path.split('/')[0]
			if (tmp_path_rules.hasOwnProperty(components.tld) === false) {
				tmp_path_rules[components.tld] = {}
			}
			if (tmp_path_rules[components.tld].hasOwnProperty(path) == false) {
				tmp_path_rules[components.tld][path] = ""
			}
			tmp_path_rules[components.tld][path] = category
		}
		this.rules.path_rules = tmp_path_rules
		
    }
	
	this.classify = function(url=false, title=false){
		//Returns a classification in the format [top_level, sub_level, method/reason]
		//This fits with the mozcat heirarchy/taxonomy: https://github.com/matthewruttley/mozcat
		
		if (!url && !title){
			return false
		}
		
		if (url != false) {
			//first check that its not a blacklisted domain
			var parsed_url = parseURL(url)
			if (this.payload.ignore_domains.hasOwnProperty(parsed_url.tld)) {
				if (this.payload.ignore_domains[parsed_url.tld].hasOwnProperty(parsed_url.suffix)) {
					return ['uncategorized', 'ignored', 'ignored_domain']
				}
			}
			
			//check if it is a single topic site
			if (this.rules.domain_rules.hasOwnProperty(parsed_url.tld)) {
				tmpResult = this.rules.domain_rules[parsed_url.tld]
				tmpResult = tmpResult.concat(['single_topic_site'])
				return tmpReturn
			}
			
			//check if it is a single topic host
			let subdomain = parsed_url.host
			if (subdomain.length > 0) {
				if (this.host_rules.hasOwnProperty(parsed_url.tld)) {
					let tmpResult = checkTree(subdomain.split('.'), domain_tree)
					if (tmpResult) {
						tmpResult = tmpResult.concat(['single_topic_host'])
						return tmpResult
					}
				}
			}
			
			//check if it is a single topic path
			if (this.path_rules.hasOwnProperty(parsed_url.tld)) {
				if (parsed_url.path.length > 0) {
					if (this.path_rules[parsed_url.tld].hasOwnProperty(parsed_url.path)) {
						toReturn = this.path_rules[parsed_url.tld][parsed_url.path]
						toReturn = toReturn.concat(['single_topic_path'])
						return toReturn
					}
				}
			}
		}
		
		//It is nothing in the domain payloads, so we now try to classify it using keywords
		
		//tokenize the url (i.e. extract things that may be words)
		let matcher_string = url+" "+title
		let words = matcher_string.match(/[a-z]{3,}/g) //must be at least 3 characters each
		
		//check that there are no ignored web words like "login" (don't want to catch some
		//accidentally unencrypted personal data)
		if (intersect_safe(this.webstoplist, words).length > 0) {
			return ['uncategorized', 'ignored', 'ignored_words']
		}
		
		//now record which words correspond to which categories, and create a tally for each
		//top level / sub level a bit like:
		//	{
		//		sports: {
		//			golf: 1,
		//			baseball: 2
		//		},
		//		science: {
		//			general: 9
		//			chemistry: 2
		//		}
		//	}
		
		let matches = {}
		for (let word of words) {
			if (this.stoplist.hasOwnProperty(word) === false) {
				if (this.positive_keywords.hasOwnProperty(word)) {
					let result = this.positive_keywords[word]
					if (matches.hasOwnProperty(result[0]) === false) {
						matches[result[0]] = {}
					}
					if (matches[result[0]].hasOwnProperty(result[1])===false) {
						matches[result[0]][result[1]] = 1
					}else{
						matches[result[0]][result[1]] += 1 //javascript really needs defaultdicts
					}
				}
			}
		}
		
		//if nothing was found, return unknown
		if (Object.keys(matches).length==0) {
			return ['uncategorized', 'unknown', 'keyword_matching']
		}
		
		//Otherwise, now that we have a series of possible top+sub level categories that the url could be in,
		//we have to decide which is the best.
		//the first stage to do this is to find the top level category with the highest number of hits in the sub level
		//categories.
		//In this case:
		//	{
		//		sports: {
		//			golf: 1,
		//			baseball: 2
		//		},
		//		science: {
		//			general: 9
		//			chemistry: 2
		//		}
		//	}
		// Sports=3 total and Science=11 total so we should choose Science
		
		let top_level = false
		let top_level_ranking = []
		let item_tree = {} //save the tree also as a list so we can sort sub_levels quickly later on
		
		//Iterate through the matches and produce a list like
		// [['Sports', 3], ['Science', 11]]
		//then sort it descending
		for (let top_level of Object.keys(matches)) {
			let sum_of_child_values = 0
			let sub_level_items = []
			
			for (let sub_level of Object.keys(matches[top_level])){
				let score = matches[top_level][sub_level]
				sum_of_child_values += score
				sub_level_items.push([sub_level, score])
			}
			
			top_level_ranking.push([top_level, sum_of_child_values])
			sub_level_items.sort(compareSecondColumn).reverse()
			item_tree[top_level] = sub_level_items
		}
		top_level_ranking.sort(compareSecondColumn).reverse()
		
		//Now we have a decisioning process.
		// - If there's only one result, it must be that one
		// - If there's more than one, choose the top one
		// - If there's more than one but they are both the same, then we return 'no consensus'.
		
		if(top_level_ranking.length == 1){
			top_level = top_level_ranking[0][0]
		}else{
			if (top_level_ranking[0][1] === top_level_ranking[1][1]) { //special case if the top two are the same
				return ['uncategorized', 'no consensus', 'keyword_matching']
			}else{
				top_level = top_level_ranking[0][0]
			}
		}
		
		//now calculate the best sub-level category
		let sub_level = false
		
		//item_tree is of the format:
		//	{
		//		sports: [[golf, 1], [baseball, 2]],
		//		science: [[general, 9], [chemistry, 2]]
		//	}
		//so we can just pick out possible sub level categories like:
		let possible_sub_levels = item_tree[top_level]
		
		//Now we have a decisioning process similar to the one above
		// - If there's only one result, it must be that one
		// - If there's more than one, choose the top one
		// - If there's more than one but they are both the same, then say 'general'
		
		if (possible_sub_levels.length == 1) {
			sub_level = item_tree[top_level][0][0]
		}else{
			//sort them
			possible_sub_levels.sort(compareSecondColumn).reverse()
			if (possible_sub_levels[0][1] === possible_sub_levels[1][1]) { //special case if the top two are the same
				sub_level = 'general'
			}else{
				sub_level = possible_sub_levels[0][0]
			}
		}
		
		return [top_level, sub_level, 'keyword_matching']
	}

    this.init();
}

exports.LICA = LICA;
