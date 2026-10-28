import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSvg, svgDimensions, svgInner, isSvgText, cleanCss } from '../packages/studio/src/vector/svgSanitize.js';
import { buildSprite, symbolId, slugify, iconFileName } from '../packages/studio/src/vector/svgSprite.js';
import { planIconSet, parseIconNames, iconPrompt, estimateIconSetTotal, MAX_ICONS } from '../packages/studio/src/vector/iconSetPlanner.js';
import { optimizeSvg, optimizeStats } from '../packages/studio/src/vector/svgOptimize.js';
import { buildZip, listZip, crc32 } from '../packages/studio/src/vector/zip.js';
import { buildIco, listIco } from '../packages/studio/src/vector/ico.js';
import { buildPdf, splitRgba } from '../packages/studio/src/vector/pdf.js';
import { classifyVectorOutput, describeVectorOutputs } from '../packages/studio/src/vector/outputs.js';
import { paletteToRecraft, paletteToPromptWords, normalizePalette, hexToRgb } from '../packages/studio/src/vector/palettes.js';
import { mapInput } from '../packages/studio/src/providers/mapper.js';
import { ROUTE_GROUPS } from '../packages/studio/src/providers/catalog/routes.generated.js';
import { SCHEMAS } from '../packages/studio/src/providers/catalog/schemas.generated.js';

// ── sanitiser ──────────────────────────────────────────────────────────────

test('sanitiser strips scripts, handlers and external references but keeps the drawing', () => {
  const dirty = `<?xml version="1.0"?>
<!DOCTYPE svg [ <!ENTITY x "y"> ]>
<svg viewBox="0 0 10 10" onload="alert(1)">
  <script>alert(2)</script>
  <defs><linearGradient id="g"><stop offset="0"/></linearGradient></defs>
  <rect width="10" height="10" fill="url(#g)" onclick="alert(3)" style="fill:url(http://evil/x.svg#f);stroke:red"/>
  <image href="https://evil.example/t.png" width="1" height="1"/>
  <image xlink:href="data:image/png;base64,iVBORw0KGgo=" width="1" height="1"/>
  <use href="#g"/>
  <a href="javascript:alert(4)"><text>hi</text></a>
  <foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><iframe src="x"></iframe></body></foreignObject>
  <style>@import url(http://evil/a.css); .a { fill: url(#g); background: url("http://evil/b.png") }</style>
</svg>`;
  const clean = sanitizeSvg(dirty);
  assert.ok(clean.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'), 'adds the namespace to the root');
  assert.doesNotMatch(clean, /<script|onload|onclick|foreignObject|iframe|ENTITY|DOCTYPE|<\?xml/i);
  assert.doesNotMatch(clean, /evil/);
  assert.doesNotMatch(clean, /javascript:/i);
  assert.doesNotMatch(clean, /@import/);
  assert.match(clean, /fill="url\(#g\)"/, 'local gradient references survive');
  assert.match(clean, /<use href="#g"\/>/, 'local use survives');
  assert.match(clean, /data:image\/png;base64/, 'inline raster data survives');
  assert.match(clean, /stroke:red/);
  assert.match(clean, /\.a \{ fill: url\(#g\); background: none \}/);
  assert.match(clean, /<text>hi<\/text>/);
});

test('sanitiser removes animations that retarget links and encoded javascript', () => {
  const clean = sanitizeSvg('<svg><a href="#x"><animate attributeName="href" values="javascript:alert(1)"/><rect width="1" height="1" href="j&#97;vascript:alert(1)"/></a></svg>');
  assert.doesNotMatch(clean, /animate|javascript|vascript/i);
  assert.match(clean, /<rect width="1" height="1"\/>/);
});

test('sanitiser returns null for things that are not SVG', () => {
  assert.equal(sanitizeSvg('<html><body>no</body></html>'), null);
  assert.equal(sanitizeSvg('\u0089PNG binary'), null);
  assert.equal(sanitizeSvg(null), null);
  assert.equal(isSvgText('  <?xml version="1.0"?><svg/>'), true);
  assert.equal(isSvgText('<div/>'), false);
});

test('svgDimensions reads the viewBox or builds one from width and height', () => {
  assert.deepEqual(svgDimensions('<svg viewBox="0 0 24 24" width="48"/>'), { viewBox: [0, 0, 24, 24], width: 48, height: null });
  assert.deepEqual(svgDimensions('<svg width="300px" height="150"/>').viewBox, [0, 0, 300, 150]);
  assert.deepEqual(svgDimensions('<svg width="100%"/>').viewBox, [0, 0, 1024, 1024]);
  assert.equal(svgInner('<svg viewBox="0 0 1 1"><g id="a"/></svg>'), '<g id="a"/>');
  assert.equal(cleanCss('a{fill:url(#ok);b:url(\'http://x/y\')}'), 'a{fill:url(#ok);b:none}');
});

// ── sprite ─────────────────────────────────────────────────────────────────

test('sprite builder makes one symbol per icon with unique, namespaced ids', () => {
  const home = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><defs><linearGradient id="a"/></defs><path d="M1 1" fill="url(#a)"/></svg>';
  const user = '<svg width="32" height="32"><defs><clipPath id="a"/></defs><circle r="4" clip-path="url(#a)"/><use href="#a"/></svg>';
  const { sprite, symbols, usage } = buildSprite([{ name: 'Home', svg: home }, { name: 'home', svg: user }, { name: '', svg: home }]);
  assert.deepEqual(symbols.map((s) => s.id), ['icon-home', 'icon-home-2', 'icon-icon']);
  assert.deepEqual(symbols.map((s) => s.viewBox), ['0 0 24 24', '0 0 32 32', '0 0 24 24']);
  assert.match(sprite, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" xmlns:xlink="http:\/\/www.w3.org\/1999\/xlink" style="display:none"><symbol id="icon-home" viewBox="0 0 24 24">/);
  assert.match(sprite, /id="icon-home-a"/);
  assert.match(sprite, /fill="url\(#icon-home-a\)"/);
  assert.match(sprite, /id="icon-home-2-a"/);
  assert.match(sprite, /clip-path="url\(#icon-home-2-a\)"/);
  assert.match(sprite, /href="#icon-home-2-a"/);
  assert.doesNotMatch(sprite, /<svg[^>]*viewBox="0 0 24 24"><defs>/, 'nested roots are unwrapped');
  assert.equal((sprite.match(/<symbol /g) || []).length, 3);
  assert.equal(usage, '<svg width="24" height="24"><use href="#icon-home"/></svg>');
});

test('symbol ids and file names are slugs', () => {
  const used = new Set();
  assert.equal(symbolId('Arrow → Right!', used), 'icon-arrow-right');
  assert.equal(symbolId('arrow right', used), 'icon-arrow-right-2');
  assert.equal(slugify('Café Menu'), 'cafe-menu');
  const names = new Set();
  assert.deepEqual([iconFileName('Home', names), iconFileName('Home', names)], ['home.svg', 'home-2.svg']);
});

// ── icon set planner ───────────────────────────────────────────────────────

test('planner reads one icon per line, drops bullets, blanks and repeats', () => {
  assert.deepEqual(parseIconNames('- home\n\n2. Search \n* home\n• Settings\nsearch'), ['home', 'Search', 'Settings']);
});

test('planner makes one run per icon with shared style and palette words, capped at the limit', () => {
  const plan = planIconSet({ names: 'home\nsearch\nsettings\nuser', style: 'thin line, rounded corners.', paletteWords: 'colour palette #111111', limit: 3 });
  assert.equal(plan.count, 3);
  assert.deepEqual(plan.skipped, ['user']);
  assert.equal(plan.truncated, true);
  assert.equal(plan.runs[0].name, 'home');
  assert.match(plan.runs[0].prompt, /^home icon\. thin line, rounded corners\. colour palette #111111\. Single icon, centered/);
  assert.equal(plan.runs[1].prompt.replace('search', 'home'), plan.runs[0].prompt, 'every icon shares the same style words');
  assert.equal(estimateIconSetTotal(plan, 0.08), 0.24);
  assert.equal(estimateIconSetTotal(plan, undefined), null);
  assert.equal(planIconSet({ names: Array.from({ length: 50 }, (_, i) => `icon ${i}`) }).count, MAX_ICONS);
  assert.equal(iconPrompt('home'), 'home icon. Single icon, centered on a plain background, consistent stroke and proportions, no text, no labels, designed as part of one icon set.');
});

// ── optimiser ──────────────────────────────────────────────────────────────

test('optimiser drops metadata, editor noise and extra precision but keeps text spacing', () => {
  const input = `<?xml version="1.0" encoding="UTF-8"?>
<!-- Generator: Adobe Illustrator -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" version="1.1" viewBox="0 0 100 100" xml:space="preserve">
  <metadata><rdf:RDF>x</rdf:RDF></metadata>
  <sodipodi:namedview id="base"/>
  <defs></defs>
  <g inkscape:label="Layer 1">
    <path d="M10.123456 20.987654 L30.5 40" fill="#000"/>
  </g>
  <text x="1.00004" y="2">hello <tspan>world</tspan></text>
</svg>`;
  const out = optimizeSvg(input);
  assert.doesNotMatch(out, /<\?xml|<!--|metadata|sodipodi|inkscape|xml:space|version="1.1"|<defs><\/defs>/);
  assert.match(out, /d="M10.123 20.988 L30.5 40"/);
  assert.match(out, /x="1"/);
  assert.match(out, /<text x="1" y="2">hello <tspan>world<\/tspan><\/text>/);
  assert.doesNotMatch(out, />\s+</);
  const stats = optimizeStats(input, out);
  assert.ok(stats.saved > 100 && stats.percent > 30, `saved ${stats.saved} bytes (${stats.percent}%)`);
});

// ── zip, ico, pdf ──────────────────────────────────────────────────────────

test('zip writer produces readable stored entries with correct CRCs', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const zip = buildZip([{ name: 'icons/home.svg', data: '<svg/>' }, { name: 'sprite.svg', data: new Uint8Array([60, 115, 118, 103, 47, 62]) }], { date: new Date(2026, 9, 27, 12, 0, 0) });
  assert.deepEqual(listZip(zip), ['icons/home.svg', 'sprite.svg']);
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50, 'end of central directory is the last record');
  assert.equal(view.getUint16(zip.length - 12, true), 2, 'two entries');
  const centralOffset = view.getUint32(zip.length - 6, true);
  assert.equal(view.getUint32(centralOffset, true), 0x02014b50, 'central directory starts where the end record says');
  assert.equal(view.getUint32(centralOffset + 16, true), crc32(new TextEncoder().encode('<svg/>')));
});

test('ico builder writes a directory that points at each PNG frame', () => {
  const png = (size) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, size]);
  const ico = buildIco([{ size: 48, png: png(48) }, { size: 16, png: png(16) }, { size: 256, png: png(255) }]);
  const frames = listIco(ico);
  assert.deepEqual(frames.map((f) => f.size), [16, 48, 256]);
  assert.deepEqual(frames.map((f) => f.length), [5, 5, 5]);
  assert.equal(frames[0].offset, 6 + 16 * 3);
  assert.equal(ico[frames[1].offset + 4], 48);
  assert.throws(() => buildIco([]));
});

test('pdf builder writes one page with the image and a valid cross-reference table', () => {
  const { rgb, alpha } = splitRgba(new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 255, 9, 9, 9, 255]), 2, 2);
  assert.deepEqual([...rgb], [255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]);
  assert.deepEqual([...alpha], [255, 128, 255, 255]);
  const pdf = buildPdf({ width: 2, height: 2, rgb, alpha, title: 'Logo (test)' });
  const text = new TextDecoder('latin1').decode(pdf);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text, /\/Type \/Page \/Parent 2 0 R \/MediaBox \[0 0 1\.5 1\.5\]/);
  assert.match(text, /\/Subtype \/Image \/Width 2 \/Height 2 \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/SMask 6 0 R \/Length 12/);
  assert.match(text, /\/Title \(Logo \\\(test\\\)\)/);
  const startxref = Number(/startxref\n(\d+)/.exec(text)[1]);
  assert.equal(text.slice(startxref, startxref + 4), 'xref');
  const offsets = [...text.matchAll(/^(\d{10}) 00000 n/gm)].map((m) => Number(m[1]));
  assert.equal(offsets.length, 7);
  offsets.forEach((offset, index) => assert.equal(text.slice(offset, offset + `${index + 1} 0 obj`.length), `${index + 1} 0 obj`));
  assert.equal(splitRgba(new Uint8Array([1, 2, 3, 255]), 1, 1).alpha, null, 'opaque images get no mask');
});

// ── output classification ──────────────────────────────────────────────────

test('outputs are classified from content type, then extension, then the first bytes', () => {
  assert.equal(classifyVectorOutput({ url: 'https://v3.fal.media/files/x/out.svg', contentType: 'image/svg+xml' }), 'svg');
  assert.equal(classifyVectorOutput({ url: 'https://v3.fal.media/files/x/z9RV.png', contentType: 'image/png' }), 'raster');
  assert.equal(classifyVectorOutput({ url: '/oga-media/abc.svg' }), 'svg');
  assert.equal(classifyVectorOutput({ url: '/oga-media/abc.bin', head: '<?xml version="1.0"?><svg' }), 'svg');
  assert.equal(classifyVectorOutput({ url: '/oga-media/abc.bin', head: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]) }), 'raster');
  assert.equal(classifyVectorOutput({ url: '/oga-media/abc.bin' }), 'unknown');
});

test('describeVectorOutputs pairs saved files with the content types fal reported', () => {
  const result = {
    media: [{ url: '/oga-media/1.svg', type: 'image', remoteUrl: 'https://cdn/a.svg' }, { url: '/oga-media/2.bin', type: 'file', remoteUrl: 'https://cdn/b' }],
    raw: { images: [{ url: 'https://cdn/a.svg', content_type: 'image/svg+xml' }, { url: 'https://cdn/b', content_type: 'image/png' }] },
  };
  assert.deepEqual(describeVectorOutputs(result).map((o) => [o.url, o.kind]), [['/oga-media/1.svg', 'svg'], ['/oga-media/2.bin', 'raster']]);
  const vectorize = describeVectorOutputs({ media: [{ url: 'https://cdn/i.svg', type: 'image' }], raw: { image: { url: 'https://cdn/i.svg', content_type: 'image/svg+xml' } } });
  assert.deepEqual(vectorize.map((o) => o.kind), ['svg']);
  assert.deepEqual(describeVectorOutputs({ outputs: ['https://cdn/plain.png'] }).map((o) => o.kind), ['raster']);
});

// ── palettes ───────────────────────────────────────────────────────────────

test('palettes become Recraft colour objects or prompt words', () => {
  const palette = { colors: ['#0ea5e9', 'not-a-colour', '#abc', '#0EA5E9'], background: '#fff' };
  assert.deepEqual(normalizePalette(palette), { colors: ['#0ea5e9', '#aabbcc'], background: '#ffffff' });
  assert.deepEqual(paletteToRecraft(palette), { colors: [{ r: 14, g: 165, b: 233 }, { r: 170, g: 187, b: 204 }], background_color: { r: 255, g: 255, b: 255 } });
  assert.deepEqual(paletteToRecraft({ colors: [], background: null }), {});
  assert.equal(paletteToPromptWords(palette), 'colour palette #0ea5e9, #aabbcc on a #ffffff background');
  assert.equal(paletteToPromptWords({ colors: [] }), '');
  assert.equal(hexToRgb('zz'), null);
});

// ── catalog routes ─────────────────────────────────────────────────────────

test('vector routes map studio payloads onto the fal schemas', () => {
  const route = (id) => ROUTE_GROUPS.vector[id][0];
  const schema = (id) => SCHEMAS.fal[route(id).endpoint];
  const recraft = mapInput({ prompt: 'fox logo', image_size: 'square_hd', colors: [{ r: 1, g: 2, b: 3 }], background_color: { r: 255, g: 255, b: 255 } }, route('recraft-v4-1-text-to-vector'), schema('recraft-v4-1-text-to-vector'));
  assert.deepEqual(recraft.input, { prompt: 'fox logo', image_size: 'square_hd', colors: [{ r: 1, g: 2, b: 3 }], background_color: { r: 255, g: 255, b: 255 } });
  assert.deepEqual(recraft.warnings, []);
  const ideogram = mapInput({ prompt: 'cat', quality: 'high', num_images: 12, aspect_ratio: '1:1', image_urls: ['a', 'b', 'c', 'd', 'e', 'f'] }, route('ideogram-vector-text-to-vector'), schema('ideogram-vector-text-to-vector'));
  assert.deepEqual(ideogram.input, { prompt: 'cat', quality: 'high', num_images: 8, aspect_ratio: '1:1', image_urls: ['a', 'b', 'c', 'd', 'e'] });
  const trace = mapInput({ image_url: 'https://x/a.png', colormode: 'binary', mode: 'polygon', filter_speckle: 99, color_precision: 0 }, route('image2svg'), schema('image2svg'));
  assert.deepEqual(trace.input, { image_url: 'https://x/a.png', colormode: 'binary', mode: 'polygon', filter_speckle: 20, color_precision: 1 });
  assert.deepEqual(mapInput({ image_url: 'https://x/a.png', mode: 'simple' }, route('ideogram-vector-image-to-vector'), schema('ideogram-vector-image-to-vector')).input, { image_url: 'https://x/a.png', mode: 'simple' });
  assert.deepEqual(mapInput({ image_url: 'https://x/a.png' }, route('recraft-vectorize'), schema('recraft-vectorize')).input, { image_url: 'https://x/a.png' });
  assert.throws(() => mapInput({}, route('recraft-vectorize'), schema('recraft-vectorize')), /image_url/);
});
