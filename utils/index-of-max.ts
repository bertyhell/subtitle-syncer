/**
 * Finds the index of the highest value in an array
 * eg: [3, 7, 4, 1, 5] => 1
 * @param arr
 * @returns index of the highest value in the array
 */
export function indexOfMax(arr: number[]): number {
	let max = 0;
	for (let i = 0; i < arr.length; i++) {
		if (arr[i] > arr[max]) max = i;
	}
	return max;
}
