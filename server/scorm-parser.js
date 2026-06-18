const path = require('path');
const fs = require('fs');
const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

function asArray(x) {
  if (x == null) return [];
  return Array.isArray(x) ? x : [x];
}

function pickText(node) {
  if (node == null) return undefined;
  if (typeof node === 'string') return node;
  if (typeof node === 'number' || typeof node === 'boolean') return String(node);
  if (typeof node === 'object' && '#text' in node) return String(node['#text']);
  return undefined;
}

function detectVersion(schemaVersion, schema) {
  const v = String(schemaVersion || schema || '').trim().toLowerCase();
  if (v.startsWith('1.2')) return '1.2';
  if (v.includes('2004') || v.includes('cam 1.3') || v.startsWith('1.3')) return '2004';
  return null;
}

function findResourceByIdentifier(resources, identifier) {
  for (const r of asArray(resources)) {
    if (r['@_identifier'] === identifier) return r;
  }
  return null;
}

// Рекурсивно ищет первое значение, чьё имя ключа удовлетворяет предикату.
function deepFind(node, keyMatch) {
  if (Array.isArray(node)) {
    for (const el of node) {
      const f = deepFind(el, keyMatch);
      if (f !== undefined) return f;
    }
    return undefined;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (keyMatch(k)) return v;
    }
    for (const v of Object.values(node)) {
      const f = deepFind(v, keyMatch);
      if (f !== undefined) return f;
    }
  }
  return undefined;
}

// Порог прохождения (0..100), заданный автором курса в манифесте, или null.
//   SCORM 1.2  → <adlcp:masteryscore> (обычно 0..100)
//   SCORM 2004 → <imsss:minNormalizedMeasure> (0..1)
function parseMasteryScore(manifest, version) {
  if (version === '2004') {
    const v = pickText(deepFind(manifest, (k) => k.toLowerCase().endsWith('minnormalizedmeasure')));
    const n = parseFloat(v);
    if (!Number.isNaN(n)) return Math.round(Math.max(0, Math.min(100, n * 100)));
  } else {
    const v = pickText(deepFind(manifest, (k) => k.toLowerCase().endsWith('masteryscore')));
    const n = parseFloat(v);
    if (!Number.isNaN(n)) return Math.round(Math.max(0, Math.min(100, n)));
  }
  return null;
}

function parseManifest(courseDir) {
  const manifestPath = path.join(courseDir, 'imsmanifest.xml');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('imsmanifest.xml not found in package root');
  }

  const xml = fs.readFileSync(manifestPath, 'utf8');
  const tree = parser.parse(xml);
  const manifest = tree.manifest;
  if (!manifest) throw new Error('invalid manifest: <manifest> root missing');

  const metadata = manifest.metadata || {};
  const schemaVersion = pickText(metadata.schemaversion);
  const schema = pickText(metadata.schema);
  const version = detectVersion(schemaVersion, schema);
  if (!version) {
    throw new Error(`unsupported SCORM schemaversion: ${schemaVersion ?? '(empty)'}`);
  }

  const orgs = manifest.organizations || {};
  const defaultOrgId = orgs['@_default'];
  const allOrgs = asArray(orgs.organization);
  const org = allOrgs.find((o) => o['@_identifier'] === defaultOrgId) || allOrgs[0];

  const resources = asArray(manifest.resources && manifest.resources.resource);

  let entryPoint = null;
  let title = pickText(org && org.title);

  if (org) {
    const firstItem = asArray(org.item)[0];
    if (firstItem) {
      const ref = firstItem['@_identifierref'];
      const resource = findResourceByIdentifier(resources, ref);
      if (resource && resource['@_href']) entryPoint = resource['@_href'];
      if (!title) title = pickText(firstItem.title);
    }
  }

  if (!entryPoint) {
    const scoResource = resources.find((r) => r['@_href'] && (r['@_adlcp:scormtype'] === 'sco' || r['@_adlcp:scormType'] === 'sco' || r['@_scormtype'] === 'sco'));
    const fallback = scoResource || resources.find((r) => r['@_href']);
    if (fallback) entryPoint = fallback['@_href'];
  }

  if (!entryPoint) throw new Error('manifest has no launchable resource');

  entryPoint = entryPoint.replace(/\\/g, '/').replace(/^\/+/, '');
  if (entryPoint.includes('..')) throw new Error('manifest entry point contains parent reference');

  if (!title) title = 'Untitled course';

  const masteryScore = parseMasteryScore(manifest, version);

  return { version, entryPoint, title: String(title).trim(), masteryScore };
}

module.exports = { parseManifest };
