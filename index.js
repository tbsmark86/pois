/*jshint esversion: 10*/

import fs from 'fs/promises';
import GpxParser from 'gpx-parser-ts';
import { getBoundingBox } from './gpx_box.js';
import { findWater } from './overpass.js';

const parser = new GpxParser.default();
const gpxRaw = await fs.readFile('/tmp/test.gpx', { encoding: 'utf8' });
const gpx = await parser.parse(gpxRaw);

Array.prototype.map.call([], function() {console.log('x')});

for(const trk of gpx.trk) {
    let points = trk.trkseg.trkpt;
    const box_1 = getBoundingBox(points, 1);
    console.log(await findWater(box_1));
}
