import * as path from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import { default as vosk } from 'vosk';
import ffmpeg from './ffmpeg/ffmpeg';
import { uniq } from 'lodash';
import { parse, stringify } from '@splayer/subtitle'

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

async function audioToSubtitle(audioPath: string, grammarList?: string[]): Promise<SubtitleEntry[]> {
	return new Promise<SubtitleEntry[]>(async (resolve, reject) => {
		const MODEL_PATH = path.resolve('./vosk-speech-model');
		const SAMPLE_RATE = 16000;
		const BUFFER_SIZE = 4000;
		const WORDS_PER_LINE = 7;

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
					if (i % WORDS_PER_LINE == 0) {
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

function srtToGrammarList(srtEntries: SubtitleEntry[]): string[] {
	return uniq(srtEntries.map(srtEntry => {
		return srtEntry.text.toLowerCase().replace(/[?!,;:.\s]+/g, ' ').split(' ');
	}).flat());
}

async function videoToSubtitleFile() {
	const videoPath = path.resolve('./example/movie.mp4');

	const audioPath = convertPathToExtension(videoPath, '.wav');
	// const audioPath = await videoToAudio(videoPath);

	const originalSrtContent = (await fs.readFile(path.resolve('./example/movie_original.srt'))).toString('utf-8');
	const srtFileOriginal = await parse(originalSrtContent);
	const grammarListOriginal = srtToGrammarList(srtFileOriginal);

	const newSrtEntries = await audioToSubtitle(audioPath, grammarListOriginal);
	const subtitlePath = convertPathToExtension(videoPath, '_generated.srt');

	const newSrtContent = stringify(newSrtEntries);
	fs.writeFileSync(subtitlePath, newSrtContent, { encoding: 'utf-8' });
	console.log('file written to: ' + subtitlePath);
	console.log('subtitle content: ' + newSrtContent);

}

videoToSubtitleFile().catch(err => console.error(err));
