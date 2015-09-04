#Python Script that compiles the LICA payload together

from sys import argv
from json import load, loads, dump
from codecs import open as copen
from urlparse import urlparse

from requests import get
from tldextract import extract as tld_extract
from pymongo import MongoClient

#SETTINGS

FILE_LOCATIONS = {
	"mozcat_heirarchy": "https://raw.githubusercontent.com/matthewruttley/mozcat/master/mozcat_heirarchy.json",
	"domain_rules": "https://raw.githubusercontent.com/matthewruttley/lica_optimize/fa643e227e33b9800a794759f7f7e35bf176c687/classification_logger/data/payload_domain_rules.json",
	"keywords": "https://raw.githubusercontent.com/matthewruttley/lica_optimize/master/classification_logger/data/payload_lica.json",
	"stopwords": "https://raw.githubusercontent.com/matthewruttley/lica_optimize/master/classification_logger/data/stopwords.json"
}

def parseURL(url):
	"""parses a url and returns a dictionary of the components
	
	combines the results of tldextract and urlparse eg
	url = 'http://sports.au.yahoo.com/something/other.html?things'
	
	urlparse(url):
		ParseResult(scheme='http', netloc='sports.au.yahoo.com', path='/something/other.html', params='', query='things', fragment='')
	
	extract(url):
		ExtractResult(subdomain='sports.au', domain='yahoo', suffix='com')	
	"""
	url = url.lower()
	url_components = urlparse(url)
	tld_components = tld_extract(url)
	
	components = {
		'subdomain': tld_components.subdomain,
		'tld': tld_components.domain + "." + tld_components.suffix,
		'path': url_components.path.split('/')
	}
	
	return components

def get_bucketerer_sites():
	"""Gets single topic sites from bucketerer"""
	
	#c = MongoClient('ec2-52-26-171-62.us-west-2.compute.amazonaws.com')
	#
	#data = {}
	#
	#for entry in c['bucketerer']['adgroups'].find():
	#	sites = entry['sites']
	#	category = entry['name']
	#	data[category] = sites
	
	with open('adgroup_dump.json') as f:
		data = load(f)
	
	return data

def bucketerer_to_mozcat():
	"""Maps bucketerer categories to mozcat categories. Loads a json file and returns a dict"""
	
	with open('bucketerer_to_mozcat_mappings.json') as f:
		data = load(f)
	
	mapping = {}
	for k, v in data.iteritems():
		mapping[k] = v.split('/') #process the mozcat names
	
	return mapping

def get_remote_payloads():
	"""imports the datasets/paylod files and returns them in a dictionary"""
	payloads = {}
	
	for file_name, url in FILE_LOCATIONS.iteritems():
		
		print "Getting {0}...".format(file_name)
		resp = get(url)
		
		if not resp.ok:
			raise Exception("Could not download {0} from {1}".format(file_name, url))
			exit()
		else:
			payloads[file_name] = loads(resp.text)
	
	return payloads

def convert_list_to_nested_object(levels, end):
	"""	Recursively builds a nested object from a list
			levels are levels you want to integrate, e.g. ['one', 'two', 'three']
			end is the value of the end item e.g. 'test'
		The result would be: {'one': {'two': {'three': 'test'}}}"""
	
	if len(levels) == 1:
		return {
			levels[0]: end
		}
	else:
		return {
			levels[0]: convert_list_to_nested_object(levels[1:], end)
		}

def process_files(output_file='lica_payload.json'):
	"""Builds the single payload file"""
	
	payload_files = get_remote_payloads() #get all the files needed
	
	final_payload = { #create 
		"domain_rules": {},
		"host_rules": {},
		"path_rules": {},
		"ignore_domains": payload_files['keywords']['ignore_domains'],
		"bad_domain_specific": payload_files['keywords']['bad_domain_specific'],
		"keywords": {},
		"stopwords": payload_files['stopwords']
	}
	
	#import mozilla's taxonomy
	#currently in the format: top_level: [sub_level, sub_level, ...]
	#lookups are faster if it is sub_level: [top_level, sub_level]
	
	taxonomy_lookup = {}
	for top_level, sub_levels in payload_files['mozcat_heirarchy'].iteritems():
		taxonomy_lookup[top_level] = [top_level, 'general']
		for sub_level in sub_levels:
			taxonomy_lookup[sub_level] = [top_level, sub_level]
	
	#process keywords
	#from: [toplevel, sublevel]: [word, word, word]
	#to: {word: [top, sub], word: [top, sub]}
	
	for top_level, sub_level_items in payload_files['keywords']['positive_words'].iteritems():
		for sub_level, keywords in sub_level_items.iteritems():
			for keyword in keywords:
				final_payload['keywords'][keyword] = [top_level, sub_level]
	
	#map domain rules to [top, sub]
	for domain, category in payload_files['domain_rules']['domain_rules'].iteritems():
		category = taxonomy_lookup[category]
		if category != 'not in use': #category is not an interest category
			final_payload['domain_rules'][domain] = category
	
	#add in the bucketerer domain rules too
	bucketerer_data = get_bucketerer_sites()
	bucketerer_mapping = bucketerer_to_mozcat()
	for category, sites in bucketerer_data.iteritems():
		category = bucketerer_mapping[category]
		for site in sites:
			if site not in final_payload['domain_rules']:
				final_payload['domain_rules'][site] = category
	
	#convert host rules
	#from: 	"au.movies.yahoo.com": "television",
	#to:	"yahoo.com": { 'au.movies':  ['arts & entertainment', 'television'] }
	#then add to the main host rules object

	for host, category in payload_files['domain_rules']['host_rules'].iteritems():
		#host really means subdomain
		components = parseURL(host)
		if components:
			if components['tld'] not in final_payload['host_rules']: #make domain in host payload if not already there
				final_payload['host_rules'][components['tld']] = {}
			if components['subdomain'] not in final_payload['host_rules'][components['tld']]:
				final_payload['host_rules'][components['tld']][components['subdomain']] = taxonomy_lookup[category]
	
	#convert the path rules into an easily searchable format
	for path, category in payload_files['domain_rules']['path_rules'].iteritems():
		components = parseURL(path)
		if components['tld'] not in final_payload['path_rules']:
			final_payload['path_rules'][components['tld']] = {}
		
		final_payload['path_rules'][components['tld']][components['path'][1]] = taxonomy_lookup[category]
	
	#write to file
	with copen(output_file, 'w', encoding='utf8') as f:
		dump(final_payload, f, sort_keys=True, indent=2)

if __name__ == '__main__':
	"""Cmd line functionality"""
	
	if len(argv) == 2:
		process_files(argv[1])
	else:
		process_files()
