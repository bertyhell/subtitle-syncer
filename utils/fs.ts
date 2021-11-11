import {stat, rm} from 'fs';

/**
 * Check if file path exists
 * @param filePath
 * @returns true if the file exists, false if the file didn't exist
 */
export function pathExists(filePath: string): Promise<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		stat(filePath, (err) => {
			if (!err) {
				// File exists
				resolve(true);
			} else if (err.code === 'ENOENT') {
				// file does not exist
				resolve(false);
			} else {
				reject(err);
			}
		});
	});
}

/**
 * Deletes a file if it exists, otherwise silently returns
 * @returns true if the file was deleted, false if the file didn't exist
 */
export function rmSilent(filePath: string): Promise<boolean> {
	return new Promise<boolean>(async (resolve, reject) => {
		pathExists(filePath).then((exists: boolean) => {
			if (exists) {
				// File exists
				rm(filePath, (err) => {
					if (err) {
						reject(err);
					}
					resolve(true);
				});
			} else {
				// File doesn't exist
				resolve(false);
			}
		}).catch(reject)
	});
}
