/*jshint esversion: 10*/

import fs from 'fs/promises';
import GpxParser from 'gpx-parser-ts';

const parser = new GpxParser.default();
const gpxRaw = await fs.readFile('/tmp/test.gpx', { encoding: 'utf8' });
const gpx = await parser.parse(gpxRaw);
console.log(gpx);
