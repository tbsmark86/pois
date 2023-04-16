/*jshint esversion: 10*/

import GpxParser from 'gpx-parser-ts';
import xml2js from 'xml2js';
import { getBoundingBox } from './gpx_box.js';
import { findWater, findCemetery, findShops, findShelter, findTanke, findToilets, findFood, findCamping, findRepair } from './overpass.js';

async function  make_kml_document(folder, name, func, open = '1') {
    console.log(`fetch ${name}`);
    let data;
    try {
	data = await func();
    } catch(e) {
	console.log(`... failed: ${e}`);
	return;
    }
    let doc = {
	'name': {_: name},
	// try to control default display in app if possible
	// (not all apps support his)
	'visibility': {_: open},
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

export async function process_gpx_string(input, filename) {
    console.log(`Parse Input ${filename}`);
    const parser = GpxParser.default ? new GpxParser.default() : new GpxParser();
    const gpx = await parser.parse(input);

    const multi_trk = gpx.trk.length;
    let kml = {
	$: {'xmlns': 'http://www.opengis.net/kml/2.2'},
    };
    if(multi_trk) {
	kml.Folder = [];
    } else {
	kml.Document = [];
    }

    // might be more then one
    for(const trk of gpx.trk) {
	const points = trk.trkseg.trkpt;
	const trk_name = trk.name || 'Unnamed';
	const box_1 = getBoundingBox(points, 1);
	const box_2 = getBoundingBox(points, 2);
	const box_3 = getBoundingBox(points, 3);
	const box_5 = getBoundingBox(points, 5);
	const box_10 = getBoundingBox(points, 10);
	const box_20 = getBoundingBox(points, 10);

	let folder;
	if(multi_trk) {
	    // extra sub-folder
	    folder = {
		'name': {_: trk_name},
		'open': {_: '1'},
		'Document': [],
	    };
	    kml.Folder.push(folder);
	} else {
	    // all types are top-level
	    folder = kml;
	}

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
    console.log('Write Output');
    const builder = new xml2js.Builder({rootName: 'kml'});
    return builder.buildObject(kml);
}
