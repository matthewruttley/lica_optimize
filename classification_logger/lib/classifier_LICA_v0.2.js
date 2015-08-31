// ----------- LICA -----------
//    Original: https://github.com/matthewruttley/mozclassify/blob/master/classifier_LICA.py
//      Author: mruttley
// Description: Javascript (FF Addon) port of Latent IAB Category Allocation (LICA).
//				Given a URL, it returns a top level and sub level category.
//
//	v0.1 - Basic version
//  v0.2 - With emtwo's suggested changes (https://github.com/matthewruttley/lica_optimize/commit/03638c9e27b8623d6ba199df03d97aca12152413?diff=unified)
//
// Usage:
//
// > lica = LICA()
// > lica.classify("http://www.coinweek.com/us-coins/the-marvelous-pogue-family-coin-collection-part-2-the-oliver-jung-1833-half-dime/")
// ['hobbies & interests', 'coins']
//
// Requires a payload file "lica_payload.json" which is compiled
// using compile_payload.py and contains:
// - Mozcat Heirarchy
//   --- Mozilla Content Service's custom interest taxonomy.
//   --- Master version: https://github.com/matthewruttley/mozcat/blob/master/mozcat_heirarchy.json
//
// - Domain Rules
//   --- a mapping of domains, subdomains and paths to categories in mozcat
//
// - Keywords
//   --- a mapping of english words to categories
//
// - Stopwords
//   --- A list of non-useful english words like a, the, and, but
//   --- Also web stopwords like account, login, password that we want to ignore 
//

//todo:
// - reconfigure the importing features
// - difference between web stopwords and english stopwords - intersect vs has own property
// - filtering out stopwords.english at the top instead
// - bigram matching working?

//import firefox services

const {data} = require('sdk/self'); //used to reference files in the /data folder
const {Cc, Ci} = require('chrome'); //these next 3 used to parse URLs
const {TextDecoder, OS} = Cu.import("resource://gre/modules/osfile.jsm", {});
let eTLDService = Cc["@mozilla.org/network/effective-tld-service;1"].getService(Ci.nsIEffectiveTLDService);
let ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);

//module code

function LICA(){
  // Class that can classify a url using LICA.
  
  //Settings
  this.payload_file_location = "lica_payload.json";
  
  //Auxiliary functionality
  this.auxiliary = {
    convert_list_to_nested_object: function(levels, end){
      //Recursively builds a nested object from a list
      //`levels` are levels you want to integrate, e.g. ['one', 'two', 'three']
      //`end` is the value of the end item e.g. 'test'
      //The result would be: {'one': {'two': {'three': 'test'}}}
      
      if (levels.length == 1) {
        let x = {};
        x[levels[0]] = end;
        return x;
      }else{
        let x = {};
        x[levels[0]] = convert_list_to_nested_object(levels.slice(1), end);
        return x;
      }
    },
    checkTree: function(levels, tree){
      //Checks to see if a series of nested keys exists in a javascript object
      
      if (levels.length == 1) {
        if (tree.hasOwnProperty(levels[0])) {
          return tree[levels[0]];
        }
        return false;
      }else{
        if (tree.hasOwnProperty(levels[0])) {
          return checkTree(levels.slice(1), tree[levels[0]]);
        }else{
          return false;
        }
      }
    },
    merge: function(first_object, second_object, path=false) {
      //merges two javascript objects
      //js port of: http://stackoverflow.com/a/7205107/849354
      //e.g.:
      // object 1: {'google.com': {'ads': [business, advertising]}}
      // object 2: {'google.com': {'shopping': [business, ecommerce]}}
      // output {'google.com': {'shopping': [business, ecommerce], 'ads': [business, advertising]}}
      
      if (!path) {
        path = [];
      }
      for(let key of Object.keys(second_object)){ //for each key in the object
        if (first_object.hasOwnProperty(key)) { //either merge
          if ((typeof(first_object) === "object") && (typeof(second_object) === "object")) {
            merge(first_object[key], second_object[key], path + [key.toString()]);
          }
        }else{
          first_object[key] = second_object[key]; //or just add the key in
        }
      }
      return first_object;
    },
    parseURL: function(url){
      //Accepts a url e.g.: https://news.politics.bbc.co.uk/thing/something?whatever=1
      //returns a useful dictionary with the components
      
      //have to add scheme if not present or ioService throws an error
      if (url.substring(0,4) != 'http') {
        return false;
      }
      
      url = ioService.newURI(url.toLowerCase(),null,null);
      let components = {};
      
      components.suffix = eTLDService.getPublicSuffix(url); //co.uk
      components.tld = eTLDService.getBaseDomain(url); //bbc.co.uk
      components.host = url.host.substring(0, url.host.length-components.tld.length-1); //news.politics
      components.path = url.path.split('?')[0].split('#')[0].substring(1); //thing/something
      
      return components;
    },
    intersect: function(a, b){
      //checks if two arrays intersect at all
      
      for (let element of a) {
        if (b.indexOf(element) != -1) {
          return true;
        }
      }
      
      return false;
    },
    compareSecondColumn: function(a, b) {
      //http://stackoverflow.com/a/16097058/849354
      if (a[1] === b[1]) {
        return 0;
      }
      else {
        return (a[1] < b[1]) ? -1 : 1;
      }
    },
    readTextFiles: function(file_locations){
      //Loosely based on:
      //https://developer.mozilla.org/en-US/docs/Mozilla/JavaScript_code_modules/Promise.jsm/Examples
      //Accepts the payload_files object as input, and tries to load them all
      //Returns their text
      
      let promises = [];
      let decoder = new TextDecoder();
      
      for (let file_description of file_locations) {//iterate through the keys of the object
        let file_location = file_locations[file_description] //grab the location
        let promise = OS.File.read(file_location) //read it async
        promise = promise.then(function onSuccess(array) {
          return decoder.decode(array);
        });
        promises.push([file_description, promise]);
      }
      return Promise.all(promises); //once they're all done, return them as an array of arrays
    },
    tokenize: function(url, title){
      //tokenizes (i.e. finds words) in a string
      let matcher_string = url+" "+title;
      let words = matcher_string.match(/[a-z]{3,}/g); //must be at least 3 characters each
      return words
    }
  };

  //Classifier matching helper functionality
  this.matching = {
    isBlacklistedDomain: function(parsedURL){
      //check that a tld isn't blacklisted
      //accepts a parsed url
      //returns a boolean
      if (payload_files.ignore_domains.hasOwnProperty(parsedURL.tld)) {
        if (payload_files.ignore_domains[parsedURL.tld].hasOwnProperty(parsedURL.suffix)) {
          return true
        }
      }
      return false
    },
    isSingleTopicSite: function(parsedURL){
      //checks if a domain is a single topic site
      //accepts a parsed url
      //returns either a classification [top level, sub level, 'single_topic_site'],
      //or false
      if (payload_files.domain_rules.hasOwnProperty(parsedURL.tld)) {
        let tmpResult = payload_files.domain_rules[parsedURL.tld];
        tmpResult.push(['single_topic_site']);
        return tmpResult;
      }
      return false;
    },
    isSingleTopicHost: function(parsedURL){
      //checks if a domain contains a single topic host
      //accepts a parsed URL
      //returns either a classification [top level, sub level, 'single_topic_subdomain'],
      //or false
      let subdomain = parsedURL.host;
      if (subdomain.length > 0) {
        if (payload_files.host_rules.hasOwnProperty(parsedURL.tld)) {
          let tmpResult = checkTree(subdomain.split('.'), payload_files.host_rules[parsedURL.tld]);
          if (tmpResult) {
            tmpResult.push(['single_topic_subdomain']);
            return tmpResult;
          }
        }
      }
      return false;
    },
    isSingleTopicPath: function(parsedURL){
      //checks if a domain contains a single topic host
      //accepts a parsed URL
      //returns either a classification [top level, sub level, 'single_topic_path'],
      //or false
      if (payload_files.path_rules.hasOwnProperty(parsedURL.tld)) {
        if (parsedURL.path.length > 0) {
          let first_chunk = parsedURL.path.split('/')[0]
          if (payload_files.path_rules[parsedURL.tld].hasOwnProperty(first_chunk)) {
            //note that this currently only checks 1 level of path
            //i.e. these are the same:
            // domain.com/tech and domain.com/tech/apple
            let tmpResult = payload_files.path_rules[parsedURL.tld][first_chunk]; 
            tmpResult.push(['single_topic_path']); 
            return tmpResult;
          }
        }
      }
      return false;
    },
    containsStopwords: function(words, stopword_type){
      //checks for the existence of stopwords
      if (intersect(payload_files.stopwords[stopword_type], words)) {
        return true;
      }
      return false;
    },
    tallyKeywords: function(words, stopword_type){
      //creates a keyword tally as a nested javascript object
      let matches = {};
      for (let word of words) {
        if (!payload_files.stopwords[stopword_type].hasOwnProperty(word)) {
          if (payload_files.positive_keywords.hasOwnProperty(word)) {
            let result = payload_files.positive_keywords[word];
            if (!matches.hasOwnProperty(result[0])) {
              matches[result[0]] = {};
            }
            if (!matches[result[0]].hasOwnProperty(result[1])) {
              matches[result[0]][result[1]] = 1;
            }else{
              matches[result[0]][result[1]] += 1; //essentially a defaultdict
            }
          }
        }
      }
      return matches
    }
  };
  
  //Actual functionality
  this.init = function(){
    //This is an initialization function used to import files into the classifier.
    //File reading is asynchronous so this must be separate from the actual set up
    //function later on, and just call it. 
    
    //convert payload files into payload locations
    locations = []
    for (let entry of payload_files) {
      payload_files[entry] = OS.Path.join(OS.Constants.Path.localProfileDir, payload_files[entry])
    }
    //send it out
    let promise = readTextFiles(payload_files);
    
    promise.then(
      function onSuccess(filesContent) {
        //now plug the values back into the payload_files object
        for (let entry of filesContent) {
          payload_files[entry[0]] = JSON.parse(entry[1])
        }
        
        //and complete the rest of the init process
        this.set_up_classifier()
        
      },
      function onFail() {
        console.error("Failed to load all LICA classifier files.");
      }
    );
  };
  
  this.set_up_classifier = function() {
    //Sets up the classifier
    
    //The payload is currently in the format: {category: [keyword, keyword...]}
    //It is kept in this format to make it easier to edit
    //Build a mapping in memory of the opposite: {kw: [top level category, sub level category]}
    this.positive_keywords = {};
    for (let top_level of Object.keys(this.payload_files.positive_words)) {
      let sub_level = this.payload_files.positive_words[top_level];
      for (let category of Object.keys(sub_level)) {
        keywords = sub_level[category];
        for (let keyword of keywords) {
          this.positive_keywords[keyword] = [top_level, category];
        }
      }
    }
  
    //create a stoplist object with words we aren't concerned with (e.g. and, but, the)
    //this is useful so we can focus on just the nouns that describe the topic
    this.stopwords = JSON.parse(data.load(payload_files.STOPWORDS));
    for (let type of Object.keys(this.stopwords)){
      //convert each list to a Set for faster lookup times
      this.stopwords[type] = new Set(this.stopwords[type]);
    }
  
    //import mozilla's taxonomy
    let mozcat = JSON.parse(data.load(payload_files.MOZCAT_HEIRARCHY));
    //currently in the format: top_level: [sub_level, sub_level, ...]
    //lookups are faster if it is sub_level: [top_level, sub_level]
    this.taxonomy = {};
    for (let top_level of Object.keys(mozcat)) {
      this.taxonomy[top_level] = [top_level, "general"];
      for (let sub_level of mozcat[top_level]) {
        this.taxonomy[sub_level] = [top_level, sub_level];
      }
    }
    
    //import domain rules and point them to [top_level, sub_level] pairs made previously
    for (let domain of Object.keys(payload_files.domain_rules)) {
      payload_files.domain_rules[domain] = this.taxonomy[payload_files.domain_rules[domain]];
    }
  
    //convert the host rules into an easily searchable format
    // from: 	"au.movies.yahoo.com": "television",
    // 	 to:	"yahoo.com": { 'movies': { 'au': ['arts & entertainment', 'television'] } }
    // then merge into the main host rules object
  
    let tmp_host_rules = {} //store them temporarily here then fill out the object
    for (let host_rule of Object.keys(payload_files.host_rules)) {
      let category = this.taxonomy[payload_files.host_rules[host_rule]];
      let components = parseURL(host_rule);
      if (components) {
        let tree = convert_list_to_nested_object(components.host.split('.').reverse(), category);
        let tld_object = {};
        tld_object[components.tld] = tree;
        merge(tmp_host_rules, tld_object);
      }
    }
    this.rules.host_rules = tmp_host_rules;
  
    //convert the path rules into an easily searchable format
    let tmp_path_rules = {};
    for (let path_rule of Object.keys(payload_files.path_rules)) {
      let category = this.taxonomy[payload_files.path_rules[path_rule]];
      let components = parseURL(path_rule);
      if (components) {
        let path = components.path.split('/')[0];
        if (!tmp_path_rules.hasOwnProperty(components.tld)) {
          tmp_path_rules[components.tld] = {};
        }
        tmp_path_rules[components.tld][path] = category;
      }
    }
    this.rules.path_rules = tmp_path_rules;
  };
	
	this.classify = function(url="", title=""){
		//Returns a classification in the format [top_level, sub_level, method/reason]
		//This fits with the mozcat heirarchy/taxonomy: https://github.com/matthewruttley/mozcat
		
		if (!url && !title){
			return ['uncategorized', 'invalid_data', 'empty_values'];
		}
		
		if (url) {
			//parse the url and return false if it is invalid
			try {
				var parsed_url = parseURL(url);
				if (!parsed_url) {
					return ['uncategorized', 'invalid_url', 'nsi_error'];
				}
			}catch(e){
				return ['uncategorized', 'url_parse_error', e];
			}
			
			//first check that its not a blacklisted domain
      if (matching.isBlacklistedDomain(parsed_url)) {
        return ['uncategorized', 'ignored', 'ignored_domain'];
      }
			
			//check if it is a single topic site
      let decision = matching.isSingleTopicSite(parsed_url);
      if (decision) return decision;
			
			//check if it is a single topic host
      decision = matching.isSingleTopicHost(parsed_url);
      if (decision) return decision;
			
			//check if it is a single topic path
      decision = matching.isSingleTopicPath(parsed_url);
      if (decision) return decision;
		}
		
		//URL is not recognized in the domain payloads, so we now try to classify it using keywords
		
    let words = auxiliary.tokenize(url, title) //tokenize the url (i.e. extract things that may be words)
		
    // check that there are no ignored web words like "login" (don't want to catch some
    // accidentally unencrypted personal data)
    if (matching.containsStopwords(words, 'web')) {
      return ['uncategorized', 'ignored', 'ignored_words']; 
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
		
    let matches = matching.tallyKeywords(words)
		
		//if nothing was found, return unknown
		if (Object.keys(matches).length == 0) {
			return ['uncategorized', 'no words known, ' + words.length + ' found', 'keyword_matching'];
		}
		
		//Otherwise, now that we have a series of possible top+sub level categories that the url could be in,
		//we have to decide which is the best.
		//the first stage to do this is to find the top level category with the highest number of hits in the sub level
		//categories.
		//In the case above, 
		// Sports=3 total and Science=11 total so we should choose Science
		
		let top_level_decision = "";
		let top_level_ranking = [];
		let item_tree = {}; //save the tree also as a list so we can sort sub_levels quickly later on
		
		//Iterate through the matches and produce a list like
		// [['Sports', 3], ['Science', 11]]
		//then sort it descending
		for (let top_level_cat of Object.keys(matches)) {
			let sum_of_child_values = 0;
			let sub_level_items = [];
			
			for (let sub_level of Object.keys(matches[top_level_cat])){
				let score = matches[top_level_cat][sub_level];
				sum_of_child_values += score;
				sub_level_items.push([sub_level, score]);
			}
			
			top_level_ranking.push([top_level_cat, sum_of_child_values]);
			sub_level_items.sort(compareSecondColumn).reverse();
			item_tree[top_level_cat] = sub_level_items;
		}
		top_level_ranking.sort(compareSecondColumn).reverse();
		
		//Now we have a decisioning process.
		// - If there's only one result, it must be that one
		// - If there's more than one, choose the top one
		// - If there's more than one but they are both the same, then we return 'no consensus'.
		
		if(top_level_ranking.length == 1){
			top_level_decision = top_level_ranking[0][0];
		}else{
			if (top_level_ranking[0][1] === top_level_ranking[1][1]) { //special case if the top two are the same
				return ['uncategorized', 'no consensus', 'keyword_matching'];
			}else{
				top_level_decision = top_level_ranking[0][0];
			}
		}
		
		//now calculate the best sub-level category
		let sub_level_decision = "";
		
		//item_tree is of the format:
		//	{
		//		sports: [[golf, 1], [baseball, 2]],
		//		science: [[general, 9], [chemistry, 2]]
		//	}
		//so we can just pick out possible sub level categories like:
		let possible_sub_levels = item_tree[top_level_decision];
		
		//Now we have a decisioning process similar to the one above
		// - If there's only one result, it must be that one
		// - If there's more than one, choose the top one
		// - If there's more than one but they are both the same, then say 'general'
		
		if (possible_sub_levels.length == 1) {
			sub_level_decision = item_tree[top_level_decision][0][0];
		}else{
			//sort them
			possible_sub_levels.sort(compareSecondColumn).reverse();
			if (possible_sub_levels[0][1] === possible_sub_levels[1][1]) { //special case if the top two are the same
				sub_level_decision = 'general';
			}else{
				sub_level_decision = possible_sub_levels[0][0];
			}
		}
		
		return [top_level_decision, sub_level_decision, 'keyword_matching'];
	};

  this.init();
}

exports.LICA = LICA;