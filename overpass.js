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
    // don't need exact street name its already on map ...
    deleteMatching(ele.tags, /^(addr:)/);
    return {
	lat: ele.center ? ele.center.lat : ele.lat,
	lon: ele.center ? ele.center.lon : ele.lon,
	name,
	text: tags2str(ele.tags),
	sym,
    };
}

const R = 6371000;
/* Source:
 * https://github.com/Leaflet/Leaflet/blob/8c38dbafb614a887a546e64aff913dc7feda9a0d/src/geo/crs/CRS.Earth.js
 *
 * Note the different type to version in gpx_box.js avoids
 * creating new object.
 */
function calcDistance(latlng1, latlng2) {
    const rad = Math.PI / 180,
	lat1 = latlng1.lat * rad,
	lat2 = latlng2.lat * rad,
	sinDLat = Math.sin((latlng2.lat - latlng1.lat) * rad / 2),
	sinDLon = Math.sin((latlng2.lon - latlng1.lon) * rad / 2),
	a = sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLon * sinDLon,
	c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/* Mark points that are near each other with an extra field 'skip' 
 * distance is in meters
 * prefer function(cur, other) return the element to skip.
 */
function filterNearbyPois(pois, distance, prefer) {
    for(let i = 0; i < pois.length; i++) {
	let ele = pois[i];
	if(ele.skip) {
	    continue;
	}

	// Assuming the total number of POIs is rather low (rarely > 1000)
	// a linear search should be fast enough and is easy done.
	const pos = ele.center ? ele.center : ele;
	for(let j = i+1; j < pois.length; j++) {
	    const other = pois[j];
	    const otherPos = other.center ? other.center : other;
	    if(!other.done && calcDistance(pos, otherPos) < distance) {
		const decision = prefer(ele, other);
		if(decision === ele) {
		    ele.skip = true;
		    ele = other;
		} else if(decision == null) {
		    // keep both
		} else {
		    other.skip = true;
		}
	    }
	}
    }
}

function isClosed(str) {
    if(str) {
	str = str.toLowerCase();
	return str.includes('abandoned') || str.includes('closed');
    }
    return false;
}

/* Filter out by typical closed markers. Do this after the query
 * because it would make the querys way to complex. */
function filterOld(pois, disused_kind) {
    return pois.filter((poi) => {
	if(poi.tags.abandoned || poi.tags[`abandoned:${disused_kind}`]) {
	    // https://wiki.openstreetmap.org/wiki/Key:abandoned
	    return false;
	} else if(poi.tags.disused || poi.tags[`disused:${disused_kind}`]) {
	    // https://wiki.openstreetmap.org/wiki/Key:disused
	    return false;
	} else if(isClosed(poi.tags.description) || isClosed(poi.tags.name)) {
	    // real life data sometimes
	    return false;
	} else if(poi.tags.opening_hours === 'closed' || poi.tags.opening_hours === 'off') {
	    // permanently close
	    // https://wiki.openstreetmap.org/wiki/Key:opening_hours
	    return false;
	}
	return true;
    });
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
	let elements = filterOld(data.elements, 'amenity');
	// don't duplicate multiple taps in same location
	filterNearbyPois(elements, 150, (ele, other) => {
	    return other;
	});
	let res = [];
	for(let ele of elements) {
	    if(ele.skip || ele.tags.drinking_water && ele.tags.drinking_water !== 'yes') {
		// should not happen, but maybe ...
		continue;
	    }
	    // not useful (for this case)
	    delete ele.tags.drinking_water;

	    res.push(makePoi(ele, 'Water', 'Drinking Water'));
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
	let elements = filterOld(data.elements, 'shop');
	let res = [];
	for(let ele of elements) {
	    let name = ele.tags.brand || 'Tanke';

	    // not useful (for this case) 
	    // to reduce spam when reading the description
	    delete ele.tags.operator; // owner name
	    delete ele.tags.car_wash;
	    deleteMatching(ele.tags, /^(fuel:|payment:)/);

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
	let elements = filterOld(data.elements, 'amenity');
	filterNearbyPois(elements, 100, (ele, other) => {
	    return other;
	});
	let res = [];
	for(let ele of elements) {
	    if(ele.skip) {
		continue;
	    }
	    deleteMatching(ele.tags, /^(toilets:)/);
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
	let elements = filterOld(data.elements, 'amenity');
	// don't duplicate multiple shelters in same location
	filterNearbyPois(elements, 200, (ele, other) => {
	    return other;
	});

	let res = [];
	for(let ele of elements) {
	    if(ele.skip) {
		continue;
	    }
	    let name = ele.tags.shelter_type || 'shelter';
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
	let elements = filterOld(data.elements, 'landuse');
	let res = [];
	for(let ele of elements) {
	    res.push(makePoi(ele, 'Cemetery'));
	}

	return res;
    });
}

export function findShops(box) {
    const query = `
	[out:json];
	nw[shop~"^(convenience|supermarket|bakery)$"]
	    ${box2poly(box)};
	out center;
    `;
    return overpass(query).then((data) => {
	let elements = filterOld(data.elements, 'shop');
	// If many points are nearby prefer supermarkets/convenience
	// store an drop the rest.
	filterNearbyPois(elements, 500, (ele, other) => {
	    const type = ele.tags.shop;
	    const otherType = other.tags.shop;
	    if(otherType === 'supermarket' && type !== otherType) {
		return ele; // skip current keep next
	    } else if(otherType === 'convenience' && type !== 'supermarket') {
		return ele; // skip current keep next
	    } else if(otherType === type) {
		return other; // skip other
	    }
	    return null; // keep both
	});
	let res = [];
	for(let ele of elements) {
	    if(ele.skip) {
		continue;
	    }
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
	let elements = filterOld(data.elements, 'amenity');
	// Skip nearby and prefer fast_food
	filterNearbyPois(elements, 1000, (ele, other) => {
	    const type = ele.tags.amenity;
	    const otherType = other.tags.amenity;
	    if(otherType === 'fast_food' && type !== otherType) {
		return ele;
	    } else  {
		return other; // skip other
	    }
	});

	let res = [];
	for(let ele of elements) {
	    if(ele.skip) {
		continue;
	    }
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
	let elements = filterOld(data.elements, 'shop');
	filterNearbyPois(elements, 100, (ele, other) => {
	    return other;
	});
	let res = [];
	for(let ele of elements) {
	    if(ele.skip) {
		continue;
	    }
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
	let elements = filterOld(data.elements, 'tourism');
	let res = [];
	for(let ele of elements) {
	    res.push(makePoi(ele, 'Camping', 'Campground'));
	}

	return res;
    });
}
