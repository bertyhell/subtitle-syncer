interface ArrayStats {
	sum: number;
	nb: number;
	avg: number;
	stddev: number;
	min: number;
	q1: number;
	median: number;
	q3: number;
	max: number;
	range: number;
	histogram: { min: number, max: number, nb: number}[];
}

export function arraystat(arr: number[], options?: {numberOfBins?: number}): ArrayStats {
	let result: Partial<ArrayStats> = {};
	const opts: {numberOfBins?: number} = {
		numberOfBins: 5,
		...(options || {}),
	}

	if (arr.length) {
		// avg
		result.sum = arr.reduce((a, x) => a + x, 0);
		result.nb = arr.length;
		result.avg = result.sum / result.nb;

		// standard deviation percent = avg(deviation) / avg
		let sumdeviation = arr.reduce((a, x) => a + Math.abs(x - (result.avg as number)), 0);
		let avgdeviation = sumdeviation / result.nb;
		result.stddev = avgdeviation / result.avg;

		// standard deviation percent = avg(deviation) / avg
		arr = [...arr].sort((a, b) => a - b);
		result.min = arr[0];
		result.q1 = quantile(arr, 0.25);
		result.median = quantile(arr, 0.5);
		result.q3 = quantile(arr, 0.75);
		result.max = arr[arr.length - 1];
		result.range = result.max - result.min;

		// histogram
		result.histogram = [];
		let nbBins = opts.numberOfBins as number;
		let i = result.min;
		let width = result.range / nbBins;
		while (nbBins--) {
			let min = i;
			let max = i + width;
			let bin = {
				min,
				max,
				nb: arr.filter((x) => {
					if (nbBins) return x >= min && x < max;
					return x >= min;
				}).length,
			};

			i += width;
			result.histogram.push(bin);
		}
	}

	return result as ArrayStats;
}

// Attention: array needs to be sorted
function quantile(arr: number[], q: number): number {
	let pos = (arr.length - 1) * q;
	let base = Math.floor(pos);
	let rest = pos - base;

	if (typeof arr[base + 1] !== 'undefined') {
		return arr[base] + rest * (arr[base + 1] - arr[base]);
	}

	return arr[base];
}
