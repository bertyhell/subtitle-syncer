"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var ffmpeg_1 = __importDefault(require("ffmpeg"));
var ffmpeg_2 = __importDefault(require("@ffmpeg-installer/ffmpeg"));
var path = __importStar(require("path"));
var fs_extra_1 = __importDefault(require("fs-extra"));
var child_process_1 = require("child_process");
var subtitle_1 = require("subtitle");
var vosk_1 = __importDefault(require("vosk"));
ffmpeg_1.default.bin = ffmpeg_2.default.path;
function videoToAudio(videoPath) {
    return __awaiter(this, void 0, void 0, function () {
        var video, wavPath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, new ffmpeg_1.default(videoPath)];
                case 1:
                    video = _a.sent();
                    wavPath = path.join(path.dirname(videoPath), path.basename(videoPath) + '.wav');
                    // ffmpeg -i input.mp4 -vn -acodec pcm_s16le -ar 44100 -ac 2 output.wav
                    video.addCommand('-vn', '');
                    video.addCommand('-acodec', 'pcm_s16le');
                    video.addCommand('-ar', '44100');
                    video.addCommand('-ac', '2');
                    return [4 /*yield*/, video.save(wavPath)];
                case 2:
                    _a.sent();
                    return [2 /*return*/, wavPath];
            }
        });
    });
}
function audioToSubtitle(audioPath) {
    return __awaiter(this, void 0, void 0, function () {
        var _this = this;
        return __generator(this, function (_a) {
            return [2 /*return*/, new Promise(function (resolve, reject) { return __awaiter(_this, void 0, void 0, function () {
                    var MODEL_PATH, SAMPLE_RATE, BUFFER_SIZE, WORDS_PER_LINE, model, rec, ffmpeg_run, subs, results;
                    return __generator(this, function (_a) {
                        switch (_a.label) {
                            case 0:
                                MODEL_PATH = path.resolve('./vosk-speech-model');
                                SAMPLE_RATE = 16000;
                                BUFFER_SIZE = 4000;
                                WORDS_PER_LINE = 7;
                                return [4 /*yield*/, fs_extra_1.default.pathExists(MODEL_PATH)];
                            case 1:
                                if (!(_a.sent())) {
                                    reject('Please download the model from https://alphacephei.com/vosk/models and unpack as ' + MODEL_PATH + ' in the current folder.');
                                    return [2 /*return*/];
                                }
                                vosk_1.default.setLogLevel(-1);
                                model = new vosk_1.default.Model(MODEL_PATH);
                                rec = new vosk_1.default.Recognizer({ model: model, sampleRate: SAMPLE_RATE });
                                rec.setWords(true);
                                ffmpeg_run = child_process_1.spawn('ffmpeg', ['-loglevel', 'quiet', '-i', audioPath,
                                    '-ar', String(SAMPLE_RATE), '-ac', '1',
                                    '-f', 's16le', '-bufsize', String(BUFFER_SIZE), '-']);
                                subs = [];
                                results = [];
                                ffmpeg_run.stdout.on('data', function (stdout) {
                                    if (rec.acceptWaveform(stdout)) {
                                        results.push(rec.result());
                                    }
                                    results.push(rec.finalResult());
                                });
                                ffmpeg_run.on('exit', function () {
                                    rec.free();
                                    model.free();
                                    results.forEach(function (element) {
                                        if (!element.hasOwnProperty('result')) {
                                            return;
                                        }
                                        var words = element.result;
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
                                        var start_index = 0;
                                        var text = words[0].word + ' ';
                                        for (var i = 1; i < words.length; i++) {
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
                                    resolve(subtitle_1.stringifySync(subs, { format: 'SRT' }));
                                });
                                return [2 /*return*/];
                        }
                    });
                }); })];
        });
    });
}
function videoToSubtitle(videoPath) {
    return __awaiter(this, void 0, void 0, function () {
        var audioPath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, videoToAudio(videoPath)];
                case 1:
                    audioPath = _a.sent();
                    return [2 /*return*/, audioToSubtitle(audioPath)];
            }
        });
    });
}
function videoToSubtitleFile() {
    return __awaiter(this, void 0, void 0, function () {
        var videoPath, subtitleContent, subtitlePath;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    videoPath = path.resolve('./test.mp4');
                    return [4 /*yield*/, videoToSubtitle(videoPath)];
                case 1:
                    subtitleContent = _a.sent();
                    subtitlePath = path.join(path.dirname(videoPath), path.basename(videoPath) + '.srt');
                    return [4 /*yield*/, fs_extra_1.default.writeFile(subtitlePath, subtitleContent, { encoding: 'utf-8' })];
                case 2:
                    _a.sent();
                    console.log('file written to: ' + subtitlePath);
                    console.log('subtitle content: ' + subtitleContent);
                    return [2 /*return*/];
            }
        });
    });
}
videoToSubtitleFile().catch(function (err) { return console.error(err); });
