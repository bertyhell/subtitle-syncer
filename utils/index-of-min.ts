/**
 * Finds the index of the lowest value in an array
 * eg: [3, 7, 4, 1, 5] => 3
 * @param arr
 * @returns index of the lowest value in the array
 */
export function indexOfMin(arr: number[]): number {
	let lowest = 0;
	for (let i = 1; i < arr.length; i++) {
		if (arr[i] < arr[lowest]) lowest = i;
	}
	return lowest;
}
