export function waitForKeypress() {
	return new Promise<void>((resolve) => {
		process.stdin.once('data', resolve);
	});
}
