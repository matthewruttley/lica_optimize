#Python Script that compiles the LICA payload together

from sys import argv
from json import loads

from requests import get

#SETTINGS

FILE_LOCATIONS = {
	"mozcat_heirarchy": "https://raw.githubusercontent.com/matthewruttley/mozcat/master/mozcat_heirarchy.json",
	"domain_rules": "https://raw.githubusercontent.com/matthewruttley/lica_optimize/master/classification_logger/data/payload_domain_rules.json",
	"keywords": "https://github.com/matthewruttley/lica_optimize/blob/master/classification_logger/data/payload_lica.json",
	"stopwords": "https://raw.githubusercontent.com/matthewruttley/lica_optimize/master/classification_logger/data/stopwords.json"
}

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
			heirarchy = loads(resp.text)
	
	return payloads


def process_files(output_file='lica_payload.json'):
	"""Builds the single payload file"""
	
	payload_files = get_remote_payloads() #get all the files needed
	
	final_payload = { #create 
		"domain_rules": payload_files['domain_rules']['domain_rules'],
		"host_rules": payload_files['host_rules'],
		"path_rules": payload_files['path_rules'],
		"ignore_domains": payload_files['keywords']['ignore_domains'],
		"bad_domain_specific": payload_files['keywords']['bad_domain_specific'],
		"keywords": {},
		"stopwords": payload_files['path_rules']['stopwords']
	}
	
	#process keywords
	#from: [toplevel, sublevel]: [word, word, word]
	#to: {word: [top, sub], word: [top, sub]}
	
	for top_level, sub_level_items in payload_files['keywords']['positive_keywords'].iteritems():
		for sub_level, keywords in sub_level_items.iteritems():
			for keyword in keywords:
				final_payload['keywords'][keyword] = [top_level, sub_level]
	
	#write to file
	with open(output_file, 'w') as f:
		dump(final_payload, f)

if __name__ == '__main__':
	"""Cmd line functionality"""
	
	if len(argv) == 2:
		process_files(argv[1])
	else:
		process_files()
