/*jshint esversion: 10*/

import fs from 'fs/promises';
import { process_gpx_string } from './main.js';

let trks = [];
if(process.argv.length < 3) {
    console.error(`Call: npm run run <input-files...>`);
    process.exit(1);
}
for(let i = 2; i < process.argv.length; ++i) {
    const file = process.argv[i];
    let target = file.replace(/.gpx/, '-pois.kml');
    if(target === file) {
	target += '-pois.kml';
    }
    console.log(`Read Input ${file} ...`);
    const input = await fs.readFile(file, { encoding: 'utf8' });
    const output = await process_gpx_string(input, file);
    console.log(`Write Output ${target} ...`);
    await fs.writeFile(target, output, 'utf8');
}
console.log('Done');
