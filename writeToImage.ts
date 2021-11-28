import { maxBy } from 'lodash';

const { createCanvas } = require('canvas');
const fs = require('fs');

const BAR_HEIGHT = 10;

export function drawSeries(path: string, series: { start: number, end: number }[][]) {
	return new Promise<void>((resolve, reject) => {
		try {
			let minX = Number.MAX_SAFE_INTEGER;
			let maxX = 0;
			const maxEntries: number = 50;
			// const maxEntries: number = maxBy(series, serie => serie.length)?.length || 0;

			// Calculate the dimensions of the images
			series.forEach((serie) => {
				serie.slice(0, 100).forEach(entry => {
					if (entry.start < minX) {
						minX = entry.start;
					}
					if (entry.end > maxX) {
						maxX = entry.end;
					}
				});
			});

			const canvas = createCanvas((maxX - minX) / 100, maxEntries * BAR_HEIGHT * (series.length + 1));
			const ctx = canvas.getContext('2d');

			const colors = ['rgba(255,0,0,1)', 'rgba(0, 255,0,1)', 'rgba(0, 0, 255,1)'];

			let height = 0;

			series.forEach((serie, serieIndex) => {
				ctx.fillStyle = colors[serieIndex];
				serie.slice(0, 100).forEach((entry, entryIndex) => {
					ctx.beginPath();
					ctx.rect(
						(entry.start - minX) / 100,
						height + entryIndex * BAR_HEIGHT * (series.length + 1),
						(entry.end - entry.start) / 100,
						BAR_HEIGHT);
					ctx.fill();
				});
				height += BAR_HEIGHT;
			});

			const out = fs.createWriteStream(path);
			const stream = canvas.createPNGStream();
			stream.pipe(out);
			out.on('finish', () => {
				console.log('The PNG file was created.');
				resolve();
			});
			out.on('error', (err: Error) => {
				reject(err);
			});
		} catch (err) {
			reject(err);
		}
	});
}
