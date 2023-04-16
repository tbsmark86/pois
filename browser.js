
// Polyfill node-js libs required by the gpx parser:
window.require = function(name) {
    if(name === 'events') {
	return Events;
    } else if(name === 'timers') {
	return {
	    setImmediate: function(func, ...args) {
		return setTimeout(func, 0, ...args);
	    }
	};
    }
    throw new Error(`No Node Polyfill for ${name}`);
};

import Events from 'events/events';
import { process_gpx_string } from './main.js';

function log(string) {
    const ele = document.getElementById('log');
    if(string === false) {
	ele.innerHTML = '';
    } else {
	// most minimal sanitizer here of course this is NOT safe for
	// the general case
	string.replace(/</g, '&lt;').replace(/>/g, '&gt;');

	ele.innerHTML += `${string}<br>`;
    }
}

async function downloadFile(suggestedName, content) {
    if(window.showSaveFilePicker) {
	try {
	    const handle = await window.showSaveFilePicker({suggestedName });
	    const writable = await handle.createWritable();
	    await writable.write(content);
	    await writable.close();
	} catch(err) {
	    log(`Failed writing output`);
	    console.log('Save failed');
	    console.error(err);
	}
    } else {
	// Fallback if the File System Access API is not supported…
	// Create the blob URL.
	const blobURL = URL.createObjectURL(new Blob([content]));
	const a = document.createElement('a');
	a.href = blobURL;
	a.download = suggestedName;
	a.style.display = 'none';
	document.body.append(a);
	a.click();
	// Revoke the blob URL and remove the element.
	setTimeout(() => {
	    URL.revokeObjectURL(blobURL);
	    a.remove();
	}, 1000);
    }
}

async function handleUpload(evt) {
    let files = evt.target.files;

    log(false); // clear
    for(let i = 0; i < files.length; i++) {
	let f = files[i];
	log(`Read ${f.name}`);
	let suggestedName = f.name.replace(/.gpx/, '-pois.kml');
	if(suggestedName === f.name) {
	     suggestedName = `${f.name}-pois.kml`;
	}
	let reader = new FileReader();
	let job = new Promise((resolve, reject) => {
	    reader.onload = async function(e) {
		const input = e.target.result;
		log(`Fecthing POIs ...`);
		const output = await process_gpx_string(input);
		log(`Save File as KML ...`);
		await downloadFile(suggestedName, output);
		resolve(e);
	    };
	    reader.onerror = function(err) {
		reject(err);
	    };
	    reader.readAsText(f);
	});
	try {
	    // serialize all files
	    await job;
	    log(`Done ${f.name}`);
	} catch(err) {
	    log(`Failed ${f.name}`);
	    console.error(`Failed File: ${job}`);
	    console.error(err);
	}
    }
}

window.startApp = function() {
    document.getElementById('gpxfile').addEventListener('change', handleUpload);
    log('Ready!');
};