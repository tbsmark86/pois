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

/* Remove points that are near each other
 * distance is in meters
 * prefer function(cur, other) return the element to skip.
 */
function filterNearbyPois(pois, distance, prefer) {
    if(!distance) {
	return pois;
    }
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
	    if(!other.skip && calcDistance(pos, otherPos) < distance) {
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
    return pois.filter((p) => !p.skip);
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
export function findWater(box, filter = 150) {
    const query = `
	[out:json];
	node[amenity~"(^drinking_water|water_point$)"]
	    [access!=private]
	    [access!=no]
	    [access!=customers]
	    [access!=permissive]
	    ${box2poly(box)};
	out;
    `;
    return overpass(query).then((data) => {
	let elements = filterOld(data.elements, 'amenity');
	// don't duplicate multiple taps in same location
	elements = filterNearbyPois(elements, filter, (ele, other) => {
	    return other;
	});
	elements = elements.filter((ele) => {
	    if(ele.tags.drinking_water && ele.tags.drinking_water !== 'yes') {
		// should not happen, but maybe ...
		return false;
	    }
	    return true;
	});
	return elements.map((ele) => {
	    // not useful (for this case)
	    delete ele.tags.drinking_water;

	    return makePoi(ele, 'Water', 'Drinking Water');
	});
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
	elements = elements.filter((ele) => {
	    // Note: The following filters might remove some useable stations
	    // because of missing tags - but from experience it's more better
	    // to have less with higher quality on the map
	    if(ele.tags.automated === 'yes') {
		// these typical have 24/7 because well automated ... but
		// nothing to buy there.
		// Guess that if not also tagged with shop there is none and
		// especially none which is open 24/7!
		if(!ele.tags.shop && !ele.tags.car_wash) {
		    return false;
		}
	    } else if(ele.tags['fuel:cng'] === 'yes' || ele.tags['fuel:lpg'] === 'yes') {
		// try guessing if this a lpg-only station
		if(ele.tags['fuel:diesel'] && ele.tags['fuel:diesel'] !== 'no') {
		    // other fuel available
		} else if(ele.tags.brand || ele.tags.shop || ele.tags.compressed_air || ele.tags.car_wash) {
		    // shop ...; known brand or air station
		} else {
		    return false;
		}

	    } else if(ele.tags['name'] === 'Tankpool24') {
		// automated brand in Germany
		return false;
	    }
	    return true;
	});
	return elements.map((ele) => {
	    let name = ele.tags.brand || '24h Gas';
	    if(ele.tags.automated === 'yes') {
		// automated is likely that opening_hours not reflect the
		// shop hours!
		name += '?';
	    } else if(ele.tags.self_service === 'yes' && !ele.tags.shop) {
		// similar
		name += '?';
	    }

	    // not useful (for this case) 
	    // to reduce spam when reading the description
	    delete ele.tags.operator; // owner name
	    delete ele.tags.car_wash;
	    deleteMatching(ele.tags, /^(fuel:|payment:)/);

	    return makePoi(ele, name, 'Gas Station');
	});
    });
}

export function findToilets(box, filter = 100) {
    const query = `
	[out:json];
	node[amenity=toilets]
	    [access!=private]
	    [access!=no]
	    [access!=customers]
	    [access!=permissive]
	    [!fixme]
	    ${box2poly(box)};
	out;
    `;

    return overpass(query).then((data) => {
	let elements = filterOld(data.elements, 'amenity');
	elements = filterNearbyPois(elements, filter, (ele, other) => {
	    return other;
	});
	return elements.map((ele) => {
	    deleteMatching(ele.tags, /^(toilets:)/);
	    return makePoi(ele, 'WC');
	});
    });
}

// https://wiki.openstreetmap.org/wiki/Key:shelter_type
export function findShelter(box, filter = 200) {
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
	elements = filterNearbyPois(elements, filter, (ele, other) => {
	    return other;
	});
	return elements.map((ele) => {
	    let name = ele.tags.shelter_type || 'shelter';
	    return makePoi(ele, name);
	});
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
	return elements.map((ele) => {
	    return makePoi(ele, 'Cemetery');
	});
    });
}

export function findShops(box, filter = 500) {
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
	elements = filterNearbyPois(elements, filter, (ele, other) => {
	    const type = ele.tags.shop;
	    const otherType = other.tags.shop;
	    if(ele.tags.opening_hours === '24/7') {
		return other; // always prefer 24/7 shop of course
	    } else if(other.tags.opening_hours === '24/7') {
		return ele;
	    } else if(otherType === 'supermarket' && type !== otherType) {
		return ele; // skip current keep next
	    } else if(otherType === 'convenience' && type !== 'supermarket') {
		return ele; // skip current keep next
	    } else if(otherType === type) {
		return other; // skip other
	    }
	    return null; // keep both
	});
	return elements.map((ele) => {
	    let type = ele.tags.shop;
	    if(ele.tags.opening_hours === '24/7') {
		type = `24h-${type}`;
	    }
	    return makePoi(ele, type, 'Shoping Center');
	});
    });
}

export function findFood(box, filter = 1000) {
    const query = `
	[out:json];
	node[amenity~"^(biergarten|cafe|fast_food|food_court|restaurant)$"]
	    ${box2poly(box)};
	out;
    `;
    return overpass(query).then((data) => {
	let elements = filterOld(data.elements, 'amenity');
	// Skip nearby and prefer fast_food
	elements = filterNearbyPois(elements, filter, (ele, other) => {
	    const type = ele.tags.amenity;
	    const otherType = other.tags.amenity;
	    if(ele.tags.opening_hours === '24/7') {
		return other; // always prefer 24/7 shop of course
	    } else if(other.tags.opening_hours === '24/7') {
		return ele;
	    } else if(otherType === 'fast_food' && type !== otherType) {
		return ele; // prefer fast_food
	    } else {
		return other; // skip other
	    }
	});
	return elements.map((ele) => {
	    let type = ele.tags.amenity;
	    if(ele.tags.opening_hours === '24/7') {
		type = `24h-${type}`;
	    }
	    return makePoi(ele, type, 'Italian Food');
	});
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
	elements = filterNearbyPois(elements, 100, (ele, other) => {
	    return other;
	});
	return elements.map((ele) => {
	    return makePoi(ele, 'Repair', 'Car');
	});
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
	return elements.map((ele) => {
	    return makePoi(ele, 'Camping', 'Campground');
	});
    });
}
