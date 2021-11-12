import * as path from 'path';
import { spawn } from 'child_process';
import { default as vosk } from 'vosk';
import ffmpeg from './ffmpeg/ffmpeg';
import { cloneDeep, compact, last, sortBy, take, uniq } from 'lodash';
import { parse, stringify } from '@splayer/subtitle';
import { distance } from 'fastest-levenshtein';
import { range } from './utils/lerp';
import { indexOfMin } from './utils/index-of-min';
import { waitForKeypress } from './utils/wait-for-key-press';
import { pathExists, rmSilent } from './utils/fs';
import { readFileSync, writeFileSync } from 'fs';

const TEXT_DISTANCE_PENALTY = 1;
const OUT_OF_SYNC_PENALTY = 1;
const PERCENTAGE_BEST_MATCHES = 30;

interface SubtitleEntry {
	start: number;
	end: number;
	text: string;
}

interface SubtitleEntrySynced extends SubtitleEntry {
	synced?: boolean;
}

interface SttResult {
	result: {
		start: number;
		end: number;
		word: string;
	}[];
}

function convertPathToExtension(filePath: string, newSuffix: string): string {
	return path.join(path.dirname(filePath), path.basename(filePath, path.extname(filePath)) + newSuffix);
}

async function videoToAudio(videoPath: string): Promise<{ wavPath: string, duration: number }> {
	const video = await new (ffmpeg as any)(videoPath);
	const wavPath = convertPathToExtension(videoPath, '.wav');

	await rmSilent(wavPath);

	// ffmpeg -i input.mp4 -vn -acodec pcm_s16le -ar 44100 -ac 2 output.wav
	video.addCommand('-vn', '');
	video.addCommand('-acodec', 'pcm_s16le');
	video.addCommand('-ar', '44100');
	video.addCommand('-ac', '2');
	await video.save(wavPath);

	return { wavPath, duration: video?.metadata?.duration?.seconds };
}

async function audioToSubtitle(audioPath: string, grammarList?: string[], maxWordsPerLine: number = 7, duration?: number): Promise<SubtitleEntry[]> {
	return new Promise<SubtitleEntry[]>(async (resolve, reject) => {
		const MODEL_PATH = path.join(__dirname, 'vosk-speech-model');
		const SAMPLE_RATE = 16000;
		const BUFFER_SIZE = 4000;

		if (!(await pathExists(MODEL_PATH))) {
			reject('Please download the model from https://alphacephei.com/vosk/models and unpack as ' + MODEL_PATH + ' in the current folder.');
			return;
		}

		vosk.setLogLevel(-1);
		const model = new vosk.Model(MODEL_PATH);
		const rec = new vosk.Recognizer({ model: model, sampleRate: SAMPLE_RATE, grammar: grammarList });
		rec.setWords(true);

		const ffmpeg_run = spawn(path.join(__dirname, 'ffmpeg/ffmpeg.exe'), ['-loglevel', 'quiet', '-i', audioPath,
			'-ar', String(SAMPLE_RATE), '-ac', '1',
			'-f', 's16le', '-bufsize', String(BUFFER_SIZE), '-']);

		const subs: SubtitleEntry[] = [];
		const results: SttResult[] = [];
		let lastPercentageOutput = 0;
		ffmpeg_run.stdout.on('data', (stdout: unknown) => {
			const currentTime = last(results)?.result?.[0]?.end;
			if (currentTime && duration) {
				// Calculate percentage completed
				const newPercentage = Math.round(currentTime / duration * 100);
				if (newPercentage !== lastPercentageOutput) {
					console.log(newPercentage + '%');
					lastPercentageOutput = newPercentage;
				}
			}
			if (rec.acceptWaveform(stdout)) {
				results.push(rec.result());
			}
			results.push(rec.finalResult());
		});

		ffmpeg_run.on('exit', () => {
			try {
				rec.free();
				model.free();
				results.forEach(element => {
					if (!element.hasOwnProperty('result')) {
						return;
					}
					const words = element.result;
					if (words.length == 1) {
						subs.push({
							start: words[0].start * 1000,
							end: words[0].end * 1000,
							text: words[0].word
						});
						return;
					}
					let start_index = 0;
					let text = words[0].word + ' ';
					for (let i = 1; i < words.length; i++) {
						text += words[i].word + ' ';
						if (i % maxWordsPerLine == 0) {
							subs.push({
								start: words[start_index].start * 1000,
								end: words[i].end * 1000,
								text: text.slice(0, text.length - 1)
							});
							start_index = i;
							text = '';
						}
					}
					if (start_index != words.length - 1) {
						subs.push({
							start: words[start_index].start * 1000,
							end: words[words.length - 1].end * 1000,
							text: text
						});
					}
				});
				resolve(subs);
			} catch (err) {
				reject(err);
			}
		});
	});
}

/**
 * Extracts a list of words used in the original subtitle file
 * This will be used to limit the speech recognition to only output these words
 *
 * A max word count is also calculated for the same reason
 * @param srtEntries
 */
function srtToGrammarList(srtEntries: SubtitleEntry[]): { grammarList: string[], maxWordCount: number } {
	let maxWordCount = 7;
	const grammarList = uniq(srtEntries.map(srtEntry => {
		const words = srtEntry.text.toLowerCase().replace(/([^0-9a-z\s]|\n)+/g, ' ').split(' ');
		if (words.length > maxWordCount) {
			maxWordCount = words.length;
		}
		return words;
	}).flat());
	return {
		grammarList,
		maxWordCount,
	};
}

/**
 * Returns a mapping function to map a value in one range to a value in another range using linear interpolation
 * @param srtEntriesOriginal
 * @param srtEntriesGenerated
 */
function getIndexMappingFunction(srtEntriesOriginal: SubtitleEntry[], srtEntriesGenerated: SubtitleEntry[]): (value: number) => number {
	return (value: number): number => {
		return range(0, srtEntriesOriginal.length, 0, srtEntriesGenerated.length, value);
	};
}

/**
 * Compares text of the current subtitle entry with all generated text entries and calculates a match score (higher is worse) based on
 * - Levenshtein distance
 * - distance of the expected subtitle position (since subtitles should remain in the same order)
 * @param entry
 * @param entryIndex
 * @param srtEntriesGenerated
 * @param mapIndexFunc
 */
function findEntryWithBestTextMatch(entry: SubtitleEntry, entryIndex: number, srtEntriesGenerated: SubtitleEntry[], mapIndexFunc: (index: number) => number): { originalIndex: number, generatedIndex: number, score: number } {
	// Calculate scores
	const scores = new Array(srtEntriesGenerated.length);
	srtEntriesGenerated.forEach((entryGenerated, generatedEntryIndex: number) => {
		const dist = distance(entryGenerated.text, entry.text);
		const estimatedIndex = mapIndexFunc(entryIndex);
		scores[generatedEntryIndex] =
			(dist / entry.text.length * TEXT_DISTANCE_PENALTY) +
			(Math.abs(estimatedIndex - generatedEntryIndex) * OUT_OF_SYNC_PENALTY);
	});

	// Pick the entry with the lowest score
	const lowestIndex = indexOfMin(scores);
	return { originalIndex: entryIndex, generatedIndex: lowestIndex, score: scores[lowestIndex] };
}

function mapSubtitleTiming(subtitleEntryOriginal: SubtitleEntry, subtitleEntryGenerated: SubtitleEntry, newSubtitleEntry: SubtitleEntry) {
	// Map centers of start and end time generated to center of start and end time original
	const centerOfGenerated = subtitleEntryGenerated.start + (subtitleEntryGenerated.end - subtitleEntryGenerated.start) / 2;
	const lengthOfOriginal = subtitleEntryOriginal.end - subtitleEntryOriginal.start;
	newSubtitleEntry.start = centerOfGenerated - lengthOfOriginal / 2;
	newSubtitleEntry.end = centerOfGenerated + lengthOfOriginal / 2;
}

function findIndexOfLeftNeighbor(entries: SubtitleEntrySynced[], startIndex: number): number {
	let index = startIndex;
	do {
		index--;
	} while (!entries[index].synced);
	return index;
}

function findIndexOfRightNeighbor(entries: SubtitleEntrySynced[], startIndex: number): number {
	let index = startIndex;
	do {
		index++;
	} while (!entries[index].synced);
	return index;
}

function getCenterOfSubtitle(sub: SubtitleEntry) {
	return sub.start + (sub.end - sub.start) / 2;
}

/**
 * Syncs the subtitle timing using interpolation
 * eg:
 * originalLeft.................originalCurrent.....originalRight
 * syncedLeft.................syncedCurrent.....syncedRight
 */
function interpolateSubtitleTiming(
	subtitleEntryOriginalLeft: SubtitleEntry, subtitleEntryOriginalCurrent: SubtitleEntry, subtitleEntryOriginalRight: SubtitleEntry,
	subtitleEntrySyncedLeft: SubtitleEntrySynced, subtitleEntrySyncedCurrent: SubtitleEntrySynced, subtitleEntrySyncedRight: SubtitleEntrySynced
) {
	const originalLeftTiming = subtitleEntryOriginalLeft.end;
	const originalCurrentTiming = getCenterOfSubtitle(subtitleEntryOriginalCurrent);
	const originalRightTiming = subtitleEntryOriginalLeft.start;
	const syncedLeftTiming = subtitleEntrySyncedLeft.end;
	const syncedRightTiming = subtitleEntrySyncedRight.start;

	// Linear interpolation
	const syncedCenterTiming = range(originalLeftTiming, originalRightTiming, syncedLeftTiming, syncedRightTiming, originalCurrentTiming);

	// Keep the subtitle duration of the original subtitle
	const lengthOfOriginal = subtitleEntryOriginalCurrent.end - subtitleEntryOriginalCurrent.start;
	subtitleEntrySyncedCurrent.start = syncedCenterTiming - lengthOfOriginal / 2;
	subtitleEntrySyncedCurrent.end = syncedCenterTiming + lengthOfOriginal / 2;
}

function reSyncSubtitle(srtEntriesOriginal: SubtitleEntry[], srtEntriesGenerated: SubtitleEntry[]): SubtitleEntry[] {
	// The generated subtitle file can contain more or less entries than the original
	// This function will translate the index of the original file (eg: 5th entry) to the expected index in the generated file (eg: 5.67) if the generated file has a few more entries
	const mapIndexFunc = getIndexMappingFunction(srtEntriesOriginal, srtEntriesGenerated);

	// Calculate which subtitle entry in the generated subtitle best matches each subtitle entry in the original subtitle
	const bestScores = srtEntriesOriginal.map((entryOriginal, index) => {
		return findEntryWithBestTextMatch(entryOriginal, index, srtEntriesGenerated, mapIndexFunc);
	});

	// Take the PERCENTAGE_BEST_MATCHES % best matches and sync those subtitle entries
	const srtEntriesSynced: SubtitleEntrySynced[] = cloneDeep(srtEntriesOriginal);
	const bestScoresSorted = sortBy(bestScores, (bestScore) => bestScore.score);
	const bestScoresPins = take(bestScoresSorted, Math.round(bestScores.length * PERCENTAGE_BEST_MATCHES / 100));
	bestScoresPins.forEach(bestScorePin => {
		mapSubtitleTiming(
			srtEntriesOriginal[bestScorePin.originalIndex],
			srtEntriesGenerated[bestScorePin.generatedIndex],
			srtEntriesSynced[bestScorePin.originalIndex]
		);
		srtEntriesSynced[bestScorePin.originalIndex].synced = true;
	});

	// Run over the remaining pins and apply linear interpolation between their 2 nearest synced subtitle neighbors
	srtEntriesSynced.forEach((subtitleEntrySynced, indexSynced) => {
		try {
			if (!subtitleEntrySynced.synced) {
				const subtitleEntrySyncedLeftIndex = findIndexOfLeftNeighbor(srtEntriesSynced, indexSynced);
				const subtitleEntrySyncedRightIndex = findIndexOfRightNeighbor(srtEntriesSynced, indexSynced);
				interpolateSubtitleTiming(
					srtEntriesOriginal[subtitleEntrySyncedLeftIndex], srtEntriesOriginal[indexSynced], srtEntriesOriginal[subtitleEntrySyncedRightIndex],
					srtEntriesSynced[subtitleEntrySyncedLeftIndex], srtEntriesSynced[indexSynced], srtEntriesSynced[subtitleEntrySyncedRightIndex]
				);
			}
		} catch(err) {
			console.error('Failed to sync subtitle. continuing...', subtitleEntrySynced);
		}
	});

	srtEntriesSynced.forEach((subtitleEntrySynced) => {
		// Wait with setting subtitle entries as synced, until all items have been interpolated
		subtitleEntrySynced.synced = true;
	});

	return srtEntriesSynced;
}

async function videoToSubtitleFile(): Promise<string> {
	// parse args
	const args = compact([process.argv.pop(), process.argv.pop()]);
	const errorArgs = 'Expected 2 files: the video (.mp4) and the subtitle file to sync (.srt). Received: [' + args.join(', ') + ']';

	let subtitlePathOriginal = args.find(arg => arg.endsWith('.srt'));
	let videoPath = args.find(arg => !arg.endsWith('.srt'));

	if (!subtitlePathOriginal || !videoPath) {
		console.error(errorArgs);
		throw errorArgs;
	}

	subtitlePathOriginal = path.resolve(subtitlePathOriginal);
	videoPath = path.resolve(videoPath);

	// Extract WAV audio from video file
	console.log('Extracting audio from video...');
	const { wavPath: audioPath, duration } = await videoToAudio(videoPath);
	console.log('Extracting audio from video...done');

	// Parse original srt with bad timings but good grammar (original)
	console.log('Parsing subtitle file...');
	const srtContentOriginal = (await readFileSync(subtitlePathOriginal)).toString('utf-8');
	const srtEntriesOriginal = await parse(srtContentOriginal);
	console.log('Parsing subtitle file...done');

	// Generate new srt with good timing but bad grammar
	console.log('Generating subtitle file from audio...');
	const grammarListOriginalResult = srtToGrammarList(srtEntriesOriginal);
	const srtEntriesGenerated = await audioToSubtitle(audioPath, grammarListOriginalResult.grammarList, grammarListOriginalResult.maxWordCount, duration);
	console.log('Generating subtitle file from audio...done');

	// Write srt file with bad grammar and good timing (generated)
	console.log('Writing generated subtitle from audio to file...');
	const srtContentGenerated = stringify(srtEntriesGenerated);
	const subtitlePathGenerated = convertPathToExtension(subtitlePathOriginal, '_generated.srt');
	writeFileSync(subtitlePathGenerated, srtContentGenerated, { encoding: 'utf-8' });
	console.log('Writing generated subtitle from audio to file...done');

	// Map the good grammar from the original onto the good timing from the generated srt
	console.log('Sync original subtitle file using generated subtitle file times...');
	const srtEntriesSynced = reSyncSubtitle(srtEntriesOriginal, srtEntriesGenerated);
	console.log('Sync original subtitle file using generated subtitle file times...done');

	// Write srt file with good grammar and good timing (synced)
	console.log('Writing re-synced subtitle to file...');
	const srtContentSynced = stringify(srtEntriesSynced);
	const subtitlePathSynced = convertPathToExtension(subtitlePathOriginal, '_synced.srt');
	writeFileSync(subtitlePathSynced, srtContentSynced, { encoding: 'utf-8' });
	console.log('Writing re-synced subtitle to file...done');

	return subtitlePathSynced;
}

videoToSubtitleFile(/* videoFilePath, subtitleFilePath */)
	.then(async (subtitlePathSynced: string) => {
		console.log('Output: ' + subtitlePathSynced);
		await waitForKeypress();
	})
	.catch(async (err) => {
		console.error('ERROR: ', err);
		await waitForKeypress();
	});
