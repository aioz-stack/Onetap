// Builds lib/tuguegaraoStreets.json, the street list each barangay's Street dropdown starts from,
// out of OpenStreetMap. Run it again to pick up new mapping:
//
//   node scripts/import-tuguegarao-streets.mjs
//
// The server adds any new street from the file to the `streets` table on start. Streets an
// administrator hid stay hidden, and approved street requests stay. The barangay names come from
// BARANGAYS in lib/address.js, the official list of 49.
//
// OpenStreetMap has boundaries for the 12 Centro barangays only. A street segment inside one of
// them belongs to it. Any other segment goes to the nearest barangay's map point, which is an
// approximation: a street can be listed under a neighbouring barangay, or miss one it runs
// through. Missing-street requests and administrators correct that over time.
//
// Data © OpenStreetMap contributors, available under the Open Database License (ODbL).

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BARANGAYS } from '../lib/address.js';

const OVERPASS = 'https://overpass-api.de/api/interpreter';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'tuguegaraoStreets.json');
// Paths, sidewalks and roads still being built aren't addresses.
const SKIP = new Set(['footway', 'path', 'steps', 'cycleway', 'bridleway', 'corridor', 'proposed', 'construction', 'track', 'platform', 'elevator']);
const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12 };

const QUERY = `[out:json][timeout:180];
area["name"~"Tuguegarao"]["boundary"="administrative"]["admin_level"="6"]->.city;
rel(area.city)["boundary"="administrative"]["admin_level"="10"];
out geom;
node(area.city)["place"~"village|hamlet|suburb|quarter|neighbourhood"];
out body;
way(area.city)["highway"]["name"];
out tags geom;`;

const key = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

// OpenStreetMap's barangay names, matched to the official ones.
function officialName(osmName) {
  const centro = /^Centro\s+([IVX]+|\d+)$/i.exec(osmName.trim());
  if (centro) {
    const number = ROMAN[centro[1].toUpperCase()] || Number(centro[1]);
    return BARANGAYS.find((name) => name.startsWith(`Centro ${String(number).padStart(2, '0')}`));
  }
  const wanted = key(osmName);
  return BARANGAYS.find((name) => key(name) === wanted) || BARANGAYS.find((name) => key(name).startsWith(wanted));
}

// "Carig" is one map point for Carig Norte and Carig Sur, so its streets are listed under both.
function officialNames(osmName) {
  if (key(osmName) === 'carig') return ['Carig Norte', 'Carig Sur'];
  const name = officialName(osmName);
  return name ? [name] : [];
}

function inside([lon, lat], ring) {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// Joins a boundary relation's outer ways into closed rings.
function rings(relation) {
  const ways = relation.members.filter((m) => m.type === 'way' && m.role !== 'inner' && m.geometry).map((m) => m.geometry.map((p) => [p.lon, p.lat]));
  const done = [];
  while (ways.length) {
    let ring = ways.shift();
    let grew = true;
    while (grew && (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])) {
      grew = false;
      for (let i = 0; i < ways.length; i += 1) {
        const way = ways[i];
        const end = ring.at(-1);
        if (way[0][0] === end[0] && way[0][1] === end[1]) ring = ring.concat(way.slice(1));
        else if (way.at(-1)[0] === end[0] && way.at(-1)[1] === end[1]) ring = ring.concat(way.slice(0, -1).reverse());
        else continue;
        ways.splice(i, 1);
        grew = true;
        break;
      }
    }
    done.push(ring);
  }
  return done;
}

const response = await fetch(OVERPASS, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'OnetapAddressImport/1.0 (Tuguegarao street list for the Onetap marketplace)' },
  body: new URLSearchParams({ data: QUERY }),
});
if (!response.ok) throw new Error(`Overpass answered ${response.status}`);
const { elements, osm3s } = await response.json();

const areas = elements.filter((e) => e.type === 'relation').flatMap((relation) => {
  const name = officialName(relation.tags.name || '');
  return name ? [{ name, rings: rings(relation) }] : [];
});
const points = elements.filter((e) => e.type === 'node').flatMap((node) => officialNames(node.tags.name || '').map((name) => ({ name, lon: node.lon, lat: node.lat })))
  // Centros are placed by their boundaries, so their points would only pull in streets from outside.
  .filter((point) => !areas.some((area) => area.name === point.name));

function barangaysFor(lon, lat) {
  const area = areas.find((candidate) => candidate.rings.some((ring) => inside([lon, lat], ring)));
  if (area) return [area.name];
  const scale = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  let found = [];
  points.forEach((point) => {
    const distance = ((point.lon - lon) * scale) ** 2 + (point.lat - lat) ** 2;
    if (distance < best - 1e-12) {
      best = distance;
      found = [point.name];
    } else if (Math.abs(distance - best) <= 1e-12) {
      found.push(point.name);
    }
  });
  return found;
}

const streets = Object.fromEntries(BARANGAYS.map((name) => [name, new Set()]));
elements.filter((e) => e.type === 'way' && !SKIP.has(e.tags.highway)).forEach((way) => {
  const name = way.tags.name.replace(/\s+/g, ' ').trim();
  // Each stretch of a long road counts where it is, so a highway is listed in every barangay it crosses.
  way.geometry.forEach((point, i) => {
    if (i % 4 !== 0 && i !== way.geometry.length - 1) return;
    barangaysFor(point.lon, point.lat).forEach((barangay) => streets[barangay]?.add(name));
  });
});

const missing = BARANGAYS.filter((name) => !areas.some((area) => area.name === name) && !points.some((point) => point.name === name));
const result = {
  source: 'OpenStreetMap',
  license: 'Data © OpenStreetMap contributors, Open Database License (ODbL) 1.0, https://www.openstreetmap.org/copyright',
  osmDataAt: osm3s?.timestamp_osm_base || '',
  generatedAt: new Date().toISOString(),
  method: 'Centro barangays by boundary; others by nearest barangay point. Approximate outside the Centros.',
  barangays: Object.fromEntries(Object.entries(streets).map(([name, set]) => [name, [...set].sort((a, b) => a.localeCompare(b))])),
};
writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
const total = new Set(Object.values(result.barangays).flat()).size;
console.log(`Wrote ${OUT}: ${total} distinct streets across ${BARANGAYS.length} barangays.`);
console.log(`Boundaries: ${areas.length}. Points: ${points.length}.${missing.length ? ` No location for: ${missing.join(', ')}.` : ''}`);
Object.entries(result.barangays).filter(([, list]) => !list.length).forEach(([name]) => console.log(`No streets mapped yet: ${name}`));
