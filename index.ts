import { default as ffmpeg } from 'ffmpeg';
import { default as ffmpegInstaller } from '@ffmpeg-installer/ffmpeg';
import * as path from 'path';
import fs from 'fs-extra';
import { spawn } from 'child_process';
import { stringifySync } from 'subtitle';
import { default as vosk } from 'vosk';

ffmpeg.bin = ffmpegInstaller.path;

interface SubtitleEntry {
	type: 'cue';
	data: {
		start: number;
		end: number;
		text: string;
	};
}

interface SttResult {
	result: {
		start: number;
		end: number;
		word: string;
	}[];
}

async function videoToAudio(videoPath: string): Promise<string> {
	const video = await new ffmpeg(videoPath);
	const wavPath = path.join(path.dirname(videoPath), path.basename(videoPath) + '.wav');
	// ffmpeg -i input.mp4 -vn -acodec pcm_s16le -ar 44100 -ac 2 output.wav
	video.addCommand('-vn', '');
	video.addCommand('-acodec', 'pcm_s16le');
	video.addCommand('-ar', '44100');
	video.addCommand('-ac', '2');
	await video.save(wavPath);

	return wavPath;
}

async function audioToSubtitle(audioPath: string): Promise<string> {
	return new Promise<string>(async (resolve, reject) => {

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
		const rec = new vosk.Recognizer({ model: model, sampleRate: SAMPLE_RATE });
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
						type: 'cue',
						data: {
							start: words[0].start,
							end: words[0].end,
							text: words[0].word
						}
					});
					return;
				}
				let start_index = 0;
				let text = words[0].word + ' ';
				for (let i = 1; i < words.length; i++) {
					text += words[i].word + ' ';
					if (i % WORDS_PER_LINE == 0) {
						subs.push({
							type: 'cue',
							data: {
								start: words[start_index].start,
								end: words[i].end,
								text: text.slice(0, text.length - 1)
							}
						});
						start_index = i;
						text = '';
					}
				}
				if (start_index != words.length - 1) {
					subs.push({
						type: 'cue',
						data: {
							start: words[start_index].start,
							end: words[words.length - 1].end,
							text: text
						}
					});
				}
			});
			resolve(stringifySync(subs, { format: 'SRT' }));
		});
	});
}

async function videoToSubtitle(videoPath: string): Promise<string> {
	const audioPath = await videoToAudio(videoPath);
	return audioToSubtitle(audioPath);
}

async function videoToSubtitleFile() {
	const videoPath = path.resolve('./test.mp4');
	const subtitleContent = await videoToSubtitle(videoPath);
	const subtitlePath = path.join(path.dirname(videoPath), path.basename(videoPath) + '.srt');
	await fs.writeFile(subtitlePath, subtitleContent, { encoding: 'utf-8' });
	console.log('file written to: ' + subtitlePath);
	console.log('subtitle content: ' + subtitleContent);
}

videoToSubtitleFile().catch(err => console.error(err));
