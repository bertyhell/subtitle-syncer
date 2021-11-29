import { isNil, maxBy } from 'lodash';
import { SubtitleEntry, SubtitleEntrySynced } from './types';

const { createCanvas } = require('canvas');
const fs = require('fs');

const BAR_HEIGHT = 10;


function getBarCoords(entry: SubtitleEntry, entryIndex: number, serieIndex: number, minX: number, numOfSeries: number): {x: number, y: number, width: number, height: number} {
	return {
		x: (entry.start - minX) / 100,
		y: serieIndex * BAR_HEIGHT + entryIndex * BAR_HEIGHT * (numOfSeries + 1),
		width: (entry.end - entry.start) / 100,
		height: BAR_HEIGHT
	};
}

export function drawSeries(path: string, series: SubtitleEntry[][]) {
	return new Promise<void>((resolve, reject) => {
		try {
			let minX = Number.MAX_SAFE_INTEGER;
			let maxX = 0;
			const maxEntries: number = 100;
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

			const canvasWidth = (maxX - minX) / 100;
			const canvasHeight = maxEntries * BAR_HEIGHT * (series.length + 1);
			const canvas = createCanvas(canvasWidth, canvasHeight);
			const ctx = canvas.getContext('2d');
			ctx.fillStyle = 'rgb(255,255,255)';
			ctx.beginPath();
			ctx.rect(
				0,
				0,
				canvasWidth,
				canvasHeight);
			ctx.fill();

			ctx.strokeStyle = 'rgb(128,128,128)';

			const colors = ['rgba(128,0,0,1)', 'rgba(0, 128,0,1)', 'rgba(0, 0, 128,1)'];

			// Draw timing intervals
			series.forEach((serie, serieIndex) => {
				ctx.fillStyle = colors[serieIndex];
				serie.slice(0, maxEntries).forEach((entry, entryIndex) => {
					// Draw rectangle
					ctx.beginPath();
					const barCoords = getBarCoords(entry, entryIndex, serieIndex, minX, series.length)
					ctx.rect(barCoords.x, barCoords.y, barCoords.width, barCoords.height);
					ctx.fill();

					// Draw text
					ctx.font = '10px Arial';
					ctx.fillText(
						entry.text.replace(/\n/, ' '),
						barCoords.x + 50,
						barCoords.y + BAR_HEIGHT - 2
					);

					// Draw best match line
					const originalIndex: number | undefined = (entry as SubtitleEntrySynced).originalIndex;
					if (!isNil(originalIndex)) {
						const barCoordsOriginal = getBarCoords(series[0][originalIndex], originalIndex, 0, minX, series.length);
						ctx.beginPath();
						ctx.moveTo(barCoords.x, barCoords.y);
						ctx.lineTo(barCoordsOriginal.x, barCoordsOriginal.y);
						ctx.stroke();
					}
				});
			});

			// Draw separation lines
			for (let rows = 0; rows < maxEntries; rows++) {
				ctx.beginPath();
				const y = rows * BAR_HEIGHT * (series.length + 1) - BAR_HEIGHT / 2;
				ctx.moveTo(0, y);
				ctx.lineTo(canvasWidth, y);
				ctx.stroke();
			}

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
