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

"use strict";

//import firefox services

const {data} = require('sdk/self'); //used to reference files in the /data folder
const {Cc, Ci, Cu} = require('chrome'); //these next 3 used to parse URLs
//const {Promise} = Cu.import("resource://gre/modules/Promise.jsm");
const {TextDecoder, OS} = Cu.import("resource://gre/modules/osfile.jsm");
let eTLDService = Cc["@mozilla.org/network/effective-tld-service;1"].getService(Ci.nsIEffectiveTLDService);
let ioService = Cc["@mozilla.org/network/io-service;1"].getService(Ci.nsIIOService);

//module code

exports.LICA = function () {
    function payloadPath(){
      return "lica_payload.json"
    }
    
    function deepCopy(obj){
      //deep copies an object to prevent assignment of extra elements to the payload
      let copy = JSON.parse(JSON.stringify(obj))
      return copy
    }
  
    function LICA(payload_text) {
      let decoder = new TextDecoder();
      this.payload = JSON.parse(decoder.decode(payload_text));
      //convert the stopword list to javascript Set() for O(1) lookups
      for (let stopword_type of Object.keys(this.payload.stopwords)){
        this.payload.stopwords[stopword_type] = new Set(this.payload.stopwords[stopword_type]);
      }
      return this;
    }
    
    // LICA methods
    Object.assign(LICA.prototype, {
      parseURL: function(url){
        //Accepts a url e.g.: https://news.politics.bbc.co.uk/thing/something?whatever=1
        //returns a useful dictionary with the components
        
        //have to add scheme if not present or ioService throws an error
        if (url.substring(0,4) != 'http') {
          throw "No valid url scheme found";
        }
        
        url = url.toLowerCase()
        
        url = ioService.newURI(url, null, null);
        let components = {};
        
        components.suffix = eTLDService.getPublicSuffix(url); //co.uk
        components.tld = eTLDService.getBaseDomain(url); //bbc.co.uk
        components.host = url.host.substring(0, url.host.length-components.tld.length-1); //news.politics
        components.path = url.path.split('?')[0].split('#')[0].substring(1); //thing/something
        
        return components;
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
      tokenize: function(url, title){
        //tokenizes (i.e. finds words) in a string
        //also removes english stopwords
        let matcher_string = url+" "+title;
        let words = [];
        for (let word of matcher_string.toLowerCase().match(/[a-z]{3,}/g)) { //must be at least 3 characters each
          if (!this.payload.stopwords.english.has(word)) { //make sure its not a stopword
            words.push(word);
          }
        }
        return words;
      },
      isBlacklistedDomain: function(parsedURL){
        //check that a tld isn't blacklisted
        //accepts a parsed url
        //returns a boolean
        if (this.payload.ignore_domains.hasOwnProperty(parsedURL.tld)) {
          if (this.payload.ignore_domains[parsedURL.tld].hasOwnProperty(parsedURL.suffix)) {
            return true;
          }
        }
        return false;
      },
      isSingleTopicSite: function(parsedURL){
        //checks if a domain is a single topic site
        //accepts a parsed url
        //returns either a classification [top level, sub level, 'single_topic_site'],
        //or false
        if (this.payload.domain_rules.hasOwnProperty(parsedURL.tld)) {
          let tmpResult = deepCopy(this.payload.domain_rules[parsedURL.tld]);
          tmpResult.push('single topic site');
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
          if (this.payload.host_rules.hasOwnProperty(parsedURL.tld)) {
            if (this.payload.host_rules[parsedURL.tld].hasOwnProperty(subdomain)) {
              let tmpResult = deepCopy(this.payload.host_rules[parsedURL.tld][subdomain]);
              tmpResult.push('single topic subdomain');
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
        if (this.payload.path_rules.hasOwnProperty(parsedURL.tld)) {
          if (parsedURL.path.length > 0) {
            let first_chunk = parsedURL.path.split('/')[0];
            if (this.payload.path_rules[parsedURL.tld].hasOwnProperty(first_chunk)) {
              //note that this currently only checks 1 level of path
              //i.e. these are the same:
              // domain.com/tech and domain.com/tech/apple
              let tmpResult = deepCopy(this.payload.path_rules[parsedURL.tld][first_chunk]);
              tmpResult.push('single topic path'); 
              return tmpResult;
            }
          }
        }
        return false;
      },
      containsStopwords: function(words, stopword_type){
        //checks for the existence of stopwords
        for (let word of words) {
          if (this.payload.stopwords[stopword_type].has(word)) {
            return true;
          }
        }
        return false;
      },
      tallyKeywords: function(words, stopword_type){
        //creates a keyword tally as a nested javascript object
        //also checks for bigrams
        
        if (words.length > 1) {
          let bigrams = [];
          for (let x=0;x<words.length-1;x++) {
            bigrams.push(words[x] + " " + words[x+1]);
          }
          words = words.concat(bigrams)
        };
        
        let matches = {};
        for (let word of words) {
          if (!this.payload.stopwords[stopword_type].hasOwnProperty(word)) {
            if (this.payload.keywords.hasOwnProperty(word)) {
              let result = this.payload.keywords[word];
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
        return matches;
      },
      classify: function(url="", title=""){
        //Returns a classification in the format [top_level, sub_level, method/reason]
        //This fits with the mozcat heirarchy/taxonomy: https://github.com/matthewruttley/mozcat
        
        if (!this.hasOwnProperty('payload')) {
          throw "LICA's classification function didn't initialize correctly."
        }
        
        if (!url && !title){
          return ['uncategorized', 'invalid_data', 'empty values'];
        }
        
        if (url) {
          //parse the url and return false if it is invalid
          try {
            var parsed_url = this.parseURL(url);
          }catch(e){
            return ['uncategorized', 'invalid url', "nsi error"];
          }
          
          //first check that its not a blacklisted domain
          if (this.isBlacklistedDomain(parsed_url)) {
            return ['uncategorized', 'ignored', 'ignored domain'];
          }
          
          //check if it is a single topic site, host or path
          for (let checker of ['isSingleTopicSite', 'isSingleTopicHost', 'isSingleTopicPath']) {
            let decision = this[checker](parsed_url);
            if (decision){
              return decision;
            }
          }
        }
        
        //URL is not recognized in the domain payloads, so we now try to classify it using keywords
        
        let words = this.tokenize(url, title); //tokenize the url (i.e. extract things that may be words)
        
        // check that there are no ignored web words like "login" (don't want to catch some
        // accidentally unencrypted personal data)
        if (this.containsStopwords(words, 'web')) {
          return ['uncategorized', 'ignored', 'ignored words']; 
        }
        
        //now record which words correspond to which categories, and create a tally for each
        //top level / sub level like:
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
        
        let matches = this.tallyKeywords(words, 'english');
        
        //if nothing was found, return unknown
        if (Object.keys(matches).length === 0) {
          return ['uncategorized', 'no words known, ' + words.length + ' found', 'keyword matching'];
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
          sub_level_items.sort(this.compareSecondColumn).reverse();
          item_tree[top_level_cat] = sub_level_items;
        }
        top_level_ranking.sort(this.compareSecondColumn).reverse();
        
        //Now we have a decisioning process.
        // - If there's only one result, it must be that one
        // - If there's more than one, choose the top one
        // - If there's more than one but they are both the same, then we return 'no consensus'.
        
        if(top_level_ranking.length == 1){
          top_level_decision = top_level_ranking[0][0];
        }else{
          if (top_level_ranking[0][1] === top_level_ranking[1][1]) { //special case if the top two are the same
            return ['uncategorized', 'no consensus', 'keyword matching'];
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
          possible_sub_levels.sort(this.compareSecondColumn).reverse();
          if (possible_sub_levels[0][1] === possible_sub_levels[1][1]) { //special case if the top two are the same
            sub_level_decision = 'general';
          }else{
            sub_level_decision = possible_sub_levels[0][0];
          }
        }
        
        return [top_level_decision, sub_level_decision, 'keyword matching'];
      }
    });

    // Asynchronously load the LICA data set. Return a Promise for a LICA object.
    function loadLICA() {
        return OS.File.read(payloadPath()).then(payload_text => {
            return new LICA(payload_text);
        });
    }
    return loadLICA;
}();
