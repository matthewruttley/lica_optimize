#Classification Logger Log Processor


from ast import literal_eval #to convert the JSON to python
from collections import defaultdict

#Settings
LOG_LOCATION = '/Users/mruttley/Desktop/classification_logger.txt'


#Functionality
def make_csv_of_stats():
	"""Creates a CSV file with some nicely formatted stats, ready to be analyzed in Excel"""

	tabs_per_time = defaultdict(list)

	with open(LOG_LOCATION) as f:
		for line in f:
			
			#check/clean line
			if len(line) > 5:
				if line.endswith('\n'):
					line = line[:-1]
				
				#parse line
				line = line.split("###")
				timestamp = line[0]
				if line[1].startswith("{"):
					data = literal_eval(line[1])
				
					#create dataset of tabs open per classification time
					tabs_per_time[data['tabs_open']].append(float(data['classification_time'][:-3]))
	
	#create csv
	
	with open('tabs_per_time.tsv', 'w') as f:
		for k, v in tabs_per_time.iteritems():
			for x in v:
				f.write("{0}\t{1}\n".format(k, x))