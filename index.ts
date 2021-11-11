import * as path from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import { default as vosk } from 'vosk';
import ffmpeg from './ffmpeg/ffmpeg';
import { cloneDeep, uniq } from 'lodash';
import { parse, stringify } from '@splayer/subtitle';
import { distance } from 'fastest-levenshtein';
import { range } from './utils/lerp';
import { indexOfMin } from './utils/index-of-min';

const TEXT_DISTANCE_PENALTY = 1;
const OUT_OF_SYNC_PENALTY = 1;

interface SubtitleEntry {
	start: number;
	end: number;
	text: string;
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

async function videoToAudio(videoPath: string): Promise<string> {
	const video = await new (ffmpeg as any)(videoPath);
	const wavPath = convertPathToExtension(videoPath, '.wav');
	await fs.rm(wavPath);
	// ffmpeg -i input.mp4 -vn -acodec pcm_s16le -ar 44100 -ac 2 output.wav
	video.addCommand('-vn', '');
	video.addCommand('-acodec', 'pcm_s16le');
	video.addCommand('-ar', '44100');
	video.addCommand('-ac', '2');
	await video.save(wavPath);

	return wavPath;
}

async function audioToSubtitle(audioPath: string, grammarList?: string[], maxWordsPerLine: number = 7): Promise<SubtitleEntry[]> {
	return new Promise<SubtitleEntry[]>(async (resolve, reject) => {
		const MODEL_PATH = path.resolve('./vosk-speech-model');
		const SAMPLE_RATE = 16000;
		const BUFFER_SIZE = 4000;

		if (!(await fs.pathExists(MODEL_PATH))) {
			reject('Please download the model from https://alphacephei.com/vosk/models and unpack as ' + MODEL_PATH + ' in the current folder.');
			return;
		}

		vosk.setLogLevel(-1);
		const model = new vosk.Model(MODEL_PATH);
		const rec = new vosk.Recognizer({ model: model, sampleRate: SAMPLE_RATE, grammar: grammarList });
		rec.setWords(true);

		const ffmpeg_run = spawn('ffmpeg', ['-loglevel', 'quiet', '-i', audioPath,
			'-ar', String(SAMPLE_RATE), '-ac', '1',
			'-f', 's16le', '-bufsize', String(BUFFER_SIZE), '-']);

		const subs: SubtitleEntry[] = [];
		const results: SttResult[] = [];
		ffmpeg_run.stdout.on('data', (stdout: unknown) => {
			if (rec.acceptWaveform(stdout)) {
				results.push(rec.result());
			}
			results.push(rec.finalResult());
		});

		ffmpeg_run.on('exit', () => {
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
function srtToGrammarList(srtEntries: SubtitleEntry[]): {grammarList: string[], maxWordCount: number} {
	let maxWordCount = 7;
	const grammarList = uniq(srtEntries.map(srtEntry => {
		const words = srtEntry.text.toLowerCase().replace(/[?!,;:.\s]+/g, ' ').split(' ');
		if (words.length > maxWordCount) {
			maxWordCount = words.length;
		}
		return words;
	}).flat());
	return {
		grammarList,
		maxWordCount,
	}
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
function findEntryWithBestTextMatch(entry: SubtitleEntry, entryIndex: number, srtEntriesGenerated: SubtitleEntry[], mapIndexFunc: (index: number) => number) {
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
	return srtEntriesGenerated[lowestIndex];
}

function reSyncSubtitle(srtEntriesOriginal: SubtitleEntry[], srtEntriesGenerated: SubtitleEntry[]): SubtitleEntry[] {
	// The generated subtitle file can contain more or less entries than the original
	// This function will translate the index of the original file (eg: 5th entry) to the expected index in the generated file (eg: 5.67) if the generated file has a few more entries
	const mapIndexFunc = getIndexMappingFunction(srtEntriesOriginal, srtEntriesGenerated);

	const srtEntriesSynced = cloneDeep(srtEntriesOriginal);
	srtEntriesOriginal.forEach((entryOriginal, index) => {
		const srtEntryGeneratedWithClosesTextMatch = findEntryWithBestTextMatch(entryOriginal, index, srtEntriesGenerated, mapIndexFunc);

		// Map centers of start and end time generated to center of start and end time original
		const centerOfGenerated = srtEntryGeneratedWithClosesTextMatch.start + (srtEntryGeneratedWithClosesTextMatch.end - srtEntryGeneratedWithClosesTextMatch.start) / 2
		const lengthOfOriginal = entryOriginal.end - entryOriginal.start;
		srtEntriesSynced[index].start = centerOfGenerated - lengthOfOriginal / 2;
		srtEntriesSynced[index].end = centerOfGenerated + lengthOfOriginal / 2;
	});

	return srtEntriesSynced;
}

async function videoToSubtitleFile() {
	// Extract WAV audio from video file
	const videoPath = path.resolve('./example/movie.mp4');
	const audioPath = convertPathToExtension(videoPath, '.wav');
	// const audioPath = await videoToAudio(videoPath);

	// Parse original srt with bad timings but good grammar (original)
	const srtContentOriginal = (await fs.readFile(path.resolve('./example/movie_original.srt'))).toString('utf-8');
	const srtEntriesOriginal = await parse(srtContentOriginal);

	// Generate new srt with good timing but bad grammar
	const grammarListOriginalResult = srtToGrammarList(srtEntriesOriginal);
	const srtEntriesGenerated = await audioToSubtitle(audioPath, grammarListOriginalResult.grammarList, grammarListOriginalResult.maxWordCount);

	// Write srt file with bad grammar and good timing (generated)
	const srtContentGenerated = stringify(srtEntriesGenerated);
	const subtitlePathGenerated = convertPathToExtension(videoPath, '_generated.srt');
	fs.writeFileSync(subtitlePathGenerated, srtContentGenerated, { encoding: 'utf-8' });

	// Map the good grammar from the original onto the good timing from the generated srt
	const srtEntriesSynced = reSyncSubtitle(srtEntriesOriginal, srtEntriesGenerated);

	// Write srt file with good grammar and good timing (synced)
	const srtContentSynced = stringify(srtEntriesSynced);
	const subtitlePathSynced = convertPathToExtension(videoPath, '_synced.srt');
	fs.writeFileSync(subtitlePathSynced, srtContentSynced, { encoding: 'utf-8' });
	console.log('file written to: ' + subtitlePathSynced);

}

videoToSubtitleFile().catch(err => console.error(err));
