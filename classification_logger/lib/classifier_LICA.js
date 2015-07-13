// Javascript (FF Addon) port of Latent IAB Category Allocation (LICA)
// Original: https://github.com/matthewruttley/mozclassify/blob/master/classifier_LICA.py
// Usage (in a different file):
// > lica = LICA()
// > lica.classify("http://www.coinweek.com/us-coins/the-marvelous-pogue-family-coin-collection-part-2-the-oliver-jung-1833-half-dime/")
// ['hobbies & interests', 'coins']

const {Cc, Ci} = require('chrome')
const {data} = require('sdk/self')
let eTLDService = Cc["@mozilla.org/network/effective-tld-service;1"].getService(Ci.nsIEffectiveTLDService);
let ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService)

function makeTree(levels, end){
	//Recursively builds a tree.
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

function LICA(){
    // Class that can classify a url using LICA.
    
    this.init = function() {
        //Sets up the classifier
		
		//import the main payload with keywords for matching/blocking
		this.payload = JSON.parse(data.load("payload_lica.json"))
		
		//Build a mapping in memory of keyword to category
		//The payload is kept in the reverse format to make it easier to edit
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
		
		//create the stoplists
		this.stopwords = JSON.parse(data.load("stopwords.json"))
		this.stoplist = {} //stopwords in english
		for (let w of this.stopwords['english']) {this.stoplist[w] = true}
		this.webstoplist = this.stopwords['web'] //web specific ignorable words
		
		//import the taxonomy
		mozcat = JSON.parse(data.load("mozcat_heirarchy.json"))
		//create v-k tree from k-[v] tree
		this.taxonomy = {}
		for (let top_level of Object.keys(mozcat)) {
			this.taxonomy[top_level] = [top_level, "general"]
			for (let sub_level of mozcat[top_level]) {
				this.taxonomy[sub_level] = [top_level, sub_level]
			}
		}
		
		//import domain rules and point them to the correct arrays
		this.rules = JSON.parse(data.load("payload_domain_rules.json"))
		for (let domain of Object.keys(this.rules.domain_rules)) {
			this.rules.domain_rules[domain] = this.taxonomy[this.rules.domain_rules[domain]]
		}
		
		//convert the host rules into an easily searchable format
		// e.g. 	"au.movies.yahoo.com": "television",
		// 			should be: "yahoo.com": { 'movies': { 'au': ['arts & entertainment', 'television'] } }
		
		this.host_rules = {}
		for (let host_rule of Object.keys(this.rules.host_rules)) {
			let category = this.taxonomy[this.rules.host_rules[host_rule]]
			let components = parseURL(host_rule)
			let tree = makeTree(components.host.split('.').reverse(), category)
			let x = {}
			x[components.tld] = tree
			merge(this.host_rules, x)
		}
		
		//convert the path rules into an easily searchable format
		this.path_rules = {}
		for (let path_rule of Object.keys(this.rules.path_rules)) {
			let category = this.taxonomy[this.rules.path_rules[path_rule]]
			let components = parseURL(path_rule)
			let path = components.path.split('/')[0]
			if (this.path_rules.hasOwnProperty(components.tld) === false) {
				this.path_rules[components.tld] = {}
			}
			if (this.path_rules[components.tld].hasOwnProperty(path) == false) {
				this.path_rules[components.tld][path] = ""
			}
			this.path_rules[components.tld][path] = category
		}
		
    }
	
	this.classify = function(url=false, title=false){
		//Returns a classification in the format [top_level, sub_level]
		//This fits with the mozcat heirarchy/taxonomy: https://github.com/matthewruttley/mozcat
		
		if (!url && !title){
			return false
		}
		
		if (url != false) {
			//first check that its not a blacklisted domain
			var parsed_url = parseURL(url)
			if (this.payload.ignore_domains.hasOwnProperty(parsed_url.tld)) {
				if (this.payload.ignore_domains[parsed_url.tld].hasOwnProperty(parsed_url.suffix)) {
					//return ['uncategorized', 'ignored']
					return ['uncategorized', 'ignored', 'ignored_domain']
				}
			}
			
			//check if it is a single topic site
			if (this.rules.domain_rules.hasOwnProperty(parsed_url.tld)) {
				//return this.rules.domain_rules[parsed_url.tld]
				toReturn = this.rules.domain_rules[parsed_url.tld]
				toReturn.push('single_topic_site')
				return toReturn
			}
			
			//check if it is a single topic host
			let subdomain = parsed_url.host
			if (subdomain.length > 0) {
				if (this.host_rules.hasOwnProperty(parsed_url.tld)) {
					let result = checkTree(subdomain.split('.'), domain_tree)
					if (result) {
						result.push('single_topic_host')
						return result
					}
				}
			}
			
			//check if it is a single topic path
			if (this.path_rules.hasOwnProperty(parsed_url.tld)) {
				if (parsed_url.path.length > 0) {
					if (this.path_rules[parsed_url.tld].hasOwnProperty(parsed_url.path)) {
						//return this.path_rules[parsed_url.tld][parsed_url.path]
						toReturn = this.path_rules[parsed_url.tld][parsed_url.path]
						toReturn.push("single_topic_path")
						return this.path_rules[parsed_url.tld][parsed_url.path]
					}
				}
			}
		}
		
		//extract URL chunks
		let matcher_string = url+" "+title
		let words = matcher_string.match(/[a-z]{3,}/g) //extract 3+ character words from the url
		
		//check that there are no ignored words
		if (intersect_safe(this.webstoplist, words).length > 0) {
			//return ['uncategorized', 'ignored']
			return ['uncategorized', 'ignored', 'ignored_words']
		}
		
		//now classify
		//find words that we have classified in the payload
		
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
						matches[result[0]][result[1]] += 1 //javascript really need defaultdicts
					}
				}
			}
		}
		
		//sort by number of hits in the sub categories
		let top_level_ranking = []
		let item_tree = {}
		
		for (let top_level of Object.keys(matches)) {
			let sum_of_child_values = 0
			sub_level_items = []
			for (let sub_level of Object.keys(matches[top_level])){
				sum_of_child_values += matches[top_level][sub_level]
				sub_level_items.push([sub_level, matches[top_level][sub_level]])
			}
			top_level_ranking.push([top_level, sum_of_child_values])
			sub_level_items.sort(compareSecondColumn).reverse()
			item_tree[top_level] = sub_level_items
		}
		top_level_ranking.sort(compareSecondColumn).reverse()
		
		//get the top_level category
		if (top_level_ranking.length == 0){
			//return ['uncategorized', 'unknown']
			return ['uncategorized', 'unknown', 'keyword_matching']
		}else if(top_level_ranking.length == 1){
			top_level = top_level_ranking[0][0]
		}else{
			if (top_level_ranking[0][1] === top_level_ranking[1][1]) { //special case if the top two are the same
				//return ['uncategorized', 'no consensus']
				return ['uncategorized', 'no consensus', 'keyword_matching']
			}else{
				top_level = top_level_ranking[0][0]
			}
		}
		
		//now calculate the sub-level category
		//must sort by number of hits after inverting (since multiple subcats can be provided)
		sub_level = {}
		for (let cat of item_tree[top_level]) {
			if (sub_level.hasOwnProperty(cat[1])) {
				sub_level[cat[1]].push(cat[0])
			}else{
				sub_level[cat[1]] = [cat[0]]
			}
		}
		
		//chain the top sublevels together
		sub_level = sub_level[Object.keys(sub_level).sort()[0]].join("/")
		
		//return [top_level, sub_level]
		return [top_level, sub_level, 'keyword_matching']
	}

    this.init();
}

exports.LICA = LICA;
