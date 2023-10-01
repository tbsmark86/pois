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
	'name': {_: 'POIs: ' + name},
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

export async function process_gpx_string(input, filename, opt) {
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

	let boxes = {};
	function getBox(size) {
	    if(!boxes[size]) {
		boxes[size] = getBoundingBox(points, size);
	    }
	    return boxes[size];
	}

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

	if(opt.cemetery) {
	    await make_kml_document(folder, 'Cemetery', () => findCemetery(getBox(opt.cemetery)), '0');
	}
	if(opt.shelter) {
	    await make_kml_document(folder, 'Shelter', () => findShelter(getBox(opt.shelter), opt.shelterFilter), '0');
	}
	if(opt.toilet) {
	    await make_kml_document(folder, 'Toilets', () => findToilets(getBox(opt.toilet), opt.toiletFilter));
	}
	if(opt.water) {
	    await make_kml_document(folder, 'Water', () => findWater(getBox(opt.water), opt.waterFilter));
	}
	if(opt.gas) {
	    await make_kml_document(folder, '24h Fuel', () => findTanke(getBox(opt.gas)));
	}
	if(opt.shop) {
	    await make_kml_document(folder, 'Shops', () => findShops(getBox(opt.shop), opt.shopFilter));
	}
	if(opt.food) {
	    await make_kml_document(folder, 'Food', () => findFood(getBox(opt.food), opt.foodFilter));
	}
	if(opt.camping) {
	    await make_kml_document(folder, 'Camping', () => findCamping(getBox(opt.camping)), '0');
	}
	if(opt.bicycle_shop) {
	    await make_kml_document(folder, 'Bicycle Shop', () => findRepair(getBox(opt.bicycle_shop)), '0');
	}
    }
    console.log('Write Output');
    const builder = new xml2js.Builder({rootName: 'kml'});
    return builder.buildObject(kml);
}
