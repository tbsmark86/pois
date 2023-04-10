/*jshint esversion: 10*/

import fs from 'fs/promises';
import GpxParser from 'gpx-parser-ts';
import xml2js from 'xml2js';
import { getBoundingBox } from './gpx_box.js';
import { findWater, findCemetery, findShops, findShelter, findTanke, findToilets, findFood, findCamping, findRepair } from './overpass.js';

let trks = [];
if(process.argv.length < 4) {
    console.error(`Call: npm run run <input-files ...> <output-file>`);
    process.exit();
}
let outputFile = process.argv.pop();
for(let i = 2; i < process.argv.length; ++i) {
    const file = process.argv[i];
    console.log(`Parse Input ${file}`);
    const parser = new GpxParser.default();
    const gpxRaw = await fs.readFile(file, { encoding: 'utf8' });
    const gpx = await parser.parse(gpxRaw);
    trks.push(...gpx.trk);
}

let kml = {
    $: {'xmlns': 'http://www.opengis.net/kml/2.2'},
    'Folder': []
};

async function  make_kml_document(folder, name, func, open = '1') {
    console.log(`${folder.name._} fetch ${name}`);
    let data;
    try {
	data = await func();
    } catch(e) {
	console.log(`... failed: ${e}`);
	return;
    }
    let doc = {
	'name': {_: name},
	'open': {_: open},
	'Placemark': [],
    };

    for(const point of data) {
	doc.Placemark.push({
	    'name': {_: point.name},
	    'description': {_: point.text},
	    'Point': {'coordinates': {_: `${point.lon},${point.lat},0`}}
	});
    }
    folder.Document.push(doc);
    console.log(`... found: ${data.length}`);
}

for(const trk of trks) {
    let points = trk.trkseg.trkpt;
    const trk_name = trk.name || 'Unnamed';
    const box_1 = getBoundingBox(points, 1);
    const box_2 = getBoundingBox(points, 2);
    const box_3 = getBoundingBox(points, 3);
    const box_5 = getBoundingBox(points, 5);
    const box_10 = getBoundingBox(points, 10);
    const box_20 = getBoundingBox(points, 10);

    let folder = {
	'name': {_: trk_name},
	'open': {_: '1'},
	'Document': [],
    };
    kml.Folder.push(folder);

    await make_kml_document(folder, 'Cementry', () => findCemetery(box_1), '0');
    await make_kml_document(folder, 'Shelter', () => findShelter(box_2), '0');
    await make_kml_document(folder, 'Toilets', () => findToilets(box_3));
    await make_kml_document(folder, 'Water', () => findWater(box_3));
    await make_kml_document(folder, '24h Fuel', () => findTanke(box_5));
    await make_kml_document(folder, 'Shops', () => findShops(box_3));
    await make_kml_document(folder, 'Food', () => findFood(box_3));

    await make_kml_document(folder, 'Camping', () => findCamping(box_10), '0');
    await make_kml_document(folder, 'Bicyle Shop', () => findRepair(box_20), '0');
}
console.log(`Write Output ${outputFile}`);
const builder = new xml2js.Builder({rootName: 'kml'});
await fs.writeFile(outputFile, builder.buildObject(kml));
