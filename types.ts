export interface SubtitleEntry {
	start: number;
	end: number;
	text: string;
}

export interface SubtitleEntrySynced extends SubtitleEntry {
	synced?: boolean;
	generatedIndex?: number;
}
