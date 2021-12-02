import { isNil, round } from 'lodash';
import { SubtitleEntry, SubtitleEntrySynced } from './types';
import { calculateHistogram } from './utils/histogram';

const asciiHistogram = require('./ascii-histogram');
const { createCanvas } = require('canvas');
const fs = require('fs');

const BAR_HEIGHT = 10;
const MAX_ENTRIES = 300;

function getBarCoords(entry: SubtitleEntry, entryIndex: number, serieIndex: number, minX: number, numOfSeries: number): { x: number, y: number, width: number, height: number, xCenter: number, yCenter: number } {
	const coords = {
		x: (entry.start - minX) / 100,
		y: serieIndex * BAR_HEIGHT + entryIndex * BAR_HEIGHT * (numOfSeries + 1),
		width: (entry.end - entry.start) / 100,
		height: BAR_HEIGHT
	};
	return {
		...coords,
		xCenter: coords.x + coords.width / 2,
		yCenter: coords.y + coords.height / 2,
	}
}

export function drawSeries(path: string, series: SubtitleEntry[][]) {
	return new Promise<void>((resolve, reject) => {
		try {
			let minX = Number.MAX_SAFE_INTEGER;
			let maxX = 0;
			const maxEntries: number = MAX_ENTRIES;
			// const maxEntries: number = maxBy(series, serie => serie.length)?.length || 0;

			// Calculate the dimensions of the images
			// Skip synced entries for size calculation since those can be quite far out of sync
			[series[0], series[1]].forEach((serie) => {
				serie.slice(0, maxEntries).forEach(entry => {
					if (entry.start < minX) {
						minX = entry.start;
					}
					if (entry.end > maxX) {
						maxX = entry.end;
					}
				});
			});

			maxX += 500; // Add a margin on the right side of the right most bar for the text

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
					const barCoords = getBarCoords(entry, entryIndex, serieIndex, minX, series.length);
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
					const generatedIndex: number | undefined = (entry as SubtitleEntrySynced).generatedIndex;
					if (
						// Found a match in the generated entries
						!isNil(generatedIndex)
						// &&
						// (generatedIndex - entryIndex) > -9.26 && (generatedIndex - entryIndex) < 13.17 &&
						// // When the text is too short, the chances of matching some random subtitle entry is too large
						// entry.text.length > 12 && series[1][generatedIndex].text.length > 12
					) {
						const barCoordsGenerated = getBarCoords(series[1][generatedIndex], generatedIndex, 1, minX, series.length);
						ctx.beginPath();
						ctx.moveTo(barCoords.xCenter, barCoords.yCenter);
						ctx.lineTo(barCoordsGenerated.xCenter, barCoordsGenerated.yCenter);
						ctx.stroke();
					}
				});
			});

			// Draw histogram of matching lines index difference
			const indexDistances: number[] = [];
			series[2].forEach((entry: SubtitleEntrySynced, entryIndex) => {
				if (!isNil(entry.generatedIndex)) {
					indexDistances.push(entry.generatedIndex - entryIndex);
				}
			});
			const histogram = calculateHistogram(indexDistances, { numberOfBins: 20 });
			console.log(asciiHistogram(Object.fromEntries(histogram.map(histogramItem => [round(histogramItem.min, 2) + ' - ' + round(histogramItem.max, 2), histogramItem.count])), {
				bar: '=',
				width: 40,
				sort: false
			}));

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
