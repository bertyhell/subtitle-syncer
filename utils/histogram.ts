export type HistogramEntry = { min: number, max: number, count: number };

export function calculateHistogram(arr: number[], options?: { numberOfBins?: number }): HistogramEntry[] {
	const opts: { numberOfBins?: number } = {
		numberOfBins: 5,
		...(options || {}),
	};

	if (!arr.length) {
		throw new Error('Can\'t calculate histogram of empty array');
	}

	arr = [...arr].sort((a, b) => a - b);
	const min = arr[0];
	const max = arr[arr.length - 1];
	const range = max - min;

	// histogram
	const histogram: HistogramEntry[] = [];
	let numberOfBins = opts.numberOfBins as number;
	let i = min;
	let width = range / numberOfBins;
	while (numberOfBins--) {
		let min = i;
		let max = i + width;
		let bin = {
			min,
			max,
			count: arr.filter((x) => {
				if (numberOfBins) {
					return x >= min && x < max;
				}
				return x >= min;
			}).length,
		};

		i += width;
		histogram.push(bin);
	}

	return histogram;
}
