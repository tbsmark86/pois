/*jshint esversion: 10*/

import fs from 'fs/promises';
import GpxParser from 'gpx-parser-ts';
import xml2js from 'xml2js';
import { getBoundingBox } from './gpx_box.js';
import { findWater, findCemetery } from './overpass.js';

console.log('Parse Input');
const parser = new GpxParser.default();
const gpxRaw = await fs.readFile('/tmp/test.gpx', { encoding: 'utf8' });
const gpx = await parser.parse(gpxRaw);

let kml = {
    $: {'xmlns': 'http://www.opengis.net/kml/2.2'},
    'Folder': []
}

async function  make_kml_document(folder, name, func) {
    console.log(`${folder.name._} fetch ${name}`);
    let data = await func();
    let doc = {
	'name': {_: name},
	'open': {_: '1'},
	'Placemark': [],
    };

    for(const water of data) {
	doc.Placemark.push({
	    'name': {_: water.name},
	    'description': {_: water.text},
	    'Point': {'coordinates': {_: `${water.lon},${water.lat},0`}}
	});
    }
    folder.Document.push(doc);
}

for(const trk of gpx.trk) {
    let points = trk.trkseg.trkpt;
    const trk_name = trk.name || 'Unnamed';
    const box_1 = getBoundingBox(points, 1);

    let folder = {
	'name': {_: trk_name},
	'open': {_: '1'},
	'Document': [],
    };
    kml.Folder.push(folder);

    await make_kml_document(folder, 'Water', () => findWater(box_1))
    await make_kml_document(folder, 'Cementry', () => findCemetery(box_1))
}
console.log('Write Output');
const builder = new xml2js.Builder({rootName: 'kml'});
await fs.writeFile('/tmp/output.kml', builder.buildObject(kml));
