const clamp = (a: number, min = 0, max = 1) => Math.min(max, Math.max(min, a));
const lerp = (x: number, y: number, a: number) => x * (1 - a) + y * a;
const invlerp = (x: number, y: number, a: number) => clamp((a - x) / (y - x));
export function range(
	rangeStart1: number,
	rangeEnd1: number,
	rangeStart2: number,
	rangeEnd2: number,
	value: number
) {
	return lerp(rangeStart2, rangeEnd2, invlerp(rangeStart1, rangeEnd1, value));
}
