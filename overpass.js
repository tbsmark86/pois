/* jshint esversion: 6 */

/**
 * execute overpass request
 */
function overpass(req) {
    const params = new URLSearchParams();
    params.append('data', req);

    return fetch('https://overpass-api.de/api/interpreter', {
	method: 'POST',
	headers: {
	    'content-type': 'application/x-www-form-urlencoded'
	},
	body: params
    }).then((response) => response.json());
}

function box2poly(box) {
    let str = '(poly:"';
    for(const p of box) {
	str += `${p.lat.toFixed(3)} ${p.lon.toFixed(3)} `;
    }
    str = str.trimRight();
    str += '")';
    return str;
}

function tags2str(tags) {
    let str = '';
    for(const tag of Object.keys(tags)) {
	str += `${tag}=${tags[tag]}`+'\n';
    }
    return str;
}

function deleteMatching(tags, re) {
    Object.keys(tags).map((key) => {
	if(re.test(key)) {
	    delete tags[key];
	}
    });
}

/**
 * Compile Data to reduced POI-Format
 * GPX Symbol see as example
 *  https://www.gpsbabel.org/htmldoc-development/GarminIcons.html
 * sadly there is no standard
 */
function makePoi(ele, name, sym) {
    // default ignored tags:
    delete ele.tags.amenity;
    delete ele.tags.wheelchair;
    return {
	lat: ele.center ? ele.center.lat : ele.lat,
	lon: ele.center ? ele.center.lon : ele.lon,
	name,
	text: tags2str(ele.tags),
	sym,
    };
}

/**
 * Box is a list of points that forms a polygon
 */
export function findWater(box) {
    const query = `
	[out:json];
	node[amenity~"(^drinking_water|water_point$)"]
	    [access!=private]
	    [access!=no]
	    [access!=permissive]
	    ${box2poly(box)};
	out;
    `;
    return overpass(query).then((data) => {
	let res = [];
	for(let ele of data.elements) {
	    if(ele.tags.drinking_water && ele.tags.drinking_water !== 'yes') {
		// should not happen, but maybe ...
		continue;
	    }
	    // not useful (for this case)
	    delete ele.tags.drinking_water;

	    res.push(makePoi(ele, 'Wasser', 'Drinking Water'));
	}

	return res;
    });
}

/**
 * Query Gas Stations with 24h shops (not for gas for food/water/toilet ...)
 */
export function findTanke(box) {
    // gas_stations may be small (nodes)
    // ore whole buildings (way) therefore search for 'nw'
    const query = `
	[out:json];
	nw[amenity=fuel]
	    [opening_hours="24/7"]
	    [shop!=no]
	    ${box2poly(box)};
	out center;
    `;

    return overpass(query).then((data) => {
	let res = [];
	for(let ele of data.elements) {
	    let name = ele.tags.brand || 'Tanke';

	    // not useful (for this case) 
	    // to reduce spam when reading the description
	    delete ele.tags.operator; // owner name
	    delete ele.tags.car_wash;
	    delete ele.tags.website;
	    deleteMatching(ele.tags, /^(addr:|brand|fuel:|payment:)/);

	    res.push(makePoi(ele, name, 'Gas Statiion'));
	}

	return res;
    });
}

export function findToilets(box) {
    const query = `
	[out:json];
	node[amenity=toilets]
	    [access!=no]
	    [access!=customers]
	    [access!=permissive]
	    [!fixme]
	    ${box2poly(box)};
	out;
    `;

    return overpass(query).then((data) => {
	let res = [];
	for(let ele of data.elements) {
	    deleteMatching(ele.tags, /^(addr:|toilets:)/);
	    res.push(makePoi(ele, 'WC'));
	}

	return res;
    });
}

// https://wiki.openstreetmap.org/wiki/Key:shelter_type
export function findShelter(box) {
    const query = `
	[out:json];
	node[amenity=shelter]
	    [access!=no]
	    [access!=private]
	    [shelter_type!=changing_rooms]
	    [shelter_type!=field_shelter]
	    [smoking!=dedicated]
	    [!fixme]
	    ${box2poly(box)};
	out;
    `;

    return overpass(query).then((data) => {
	let res = [];
	for(let ele of data.elements) {
	    let name = ele.tags.shelter_type || 'shelter';
	    deleteMatching(ele.tags, /^(addr:)/);
	    res.push(makePoi(ele, name));
	}

	return res;
    });
}

export function findCemetery(box) {
    const query = `
	[out:json];
	way[landuse=cemetery]
	    ${box2poly(box)};
	out center;
    `;

    return overpass(query).then((data) => {
	let res = [];
	for(let ele of data.elements) {
	    deleteMatching(ele.tags, /^(addr:)/);
	    res.push(makePoi(ele, 'Friedhof'));
	}

	return res;
    });
}

export function findShops(box) {
    const query = `
	[out:json];
	nw[shop~"^(yes|kiosk|convenience|supermarket|bakery)$"]
	    ${box2poly(box)};
	out center;
    `;
    return overpass(query).then((data) => {
	let res = [];
	for(let ele of data.elements) {
	    let type = ele.tags.shop;
	    res.push(makePoi(ele, type, 'Shoping Center'));
	}

	return res;
    });
}

export function findFood(box) {
    const query = `
	[out:json];
	node[amenity~"^(biergarten|cafe|fast_food|food_court|restaurant)$"]
	    ${box2poly(box)};
	out;
    `;
    return overpass(query).then((data) => {
	let res = [];
	for(let ele of data.elements) {
	    let type = ele.tags.amenity;
	    res.push(makePoi(ele, type, 'Italian Food'));
	}

	return res;
    });
}

export function findRepair(box) {
    const query = `
	[out:json];
	node[shop=bicycle]
	    ${box2poly(box)};
	out;
    `;
    return overpass(query).then((data) => {
	let res = [];
	for(let ele of data.elements) {
	    res.push(makePoi(ele, 'Repair', 'Car'));
	}

	return res;
    });
}

export function findCamping(box) {
    const query = `
	[out:json];
	nw[tourism=camp_site]
	    [tents!=no]
	    [group_only!=yes]
	    [nudism!=yes][nudism!=designated]
	    ${box2poly(box)};
	out center;
    `;
    return overpass(query).then((data) => {
	let res = [];
	for(let ele of data.elements) {
	    res.push(makePoi(ele, 'Camping', 'Campground'));
	}

	return res;
    });
}
