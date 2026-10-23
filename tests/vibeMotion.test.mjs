import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTENT_SECURITY_POLICY,
  buildEditMessages,
  buildGenerateMessages,
  clampDuration,
  extractHtml,
  extractTitle,
  prepareDocument,
} from '../packages/studio/src/vibeMotion.js';

const DOC = '<!DOCTYPE html><html><head><title>Summer Sale</title></head><body><canvas id="stage" width="1920" height="1080"></canvas><script>window.__render=function(t){}</script></body></html>';

test('clamps durations to 3-15 seconds', () => {
  assert.equal(clampDuration(1), 3);
  assert.equal(clampDuration(6.4), 6);
  assert.equal(clampDuration(40), 15);
  assert.equal(clampDuration('abc'), 6);
});

test('extracts the document from fenced or chatty replies', () => {
  assert.equal(extractHtml(`Here you go:\n\`\`\`html\n${DOC}\n\`\`\`\nEnjoy!`), DOC);
  assert.equal(extractHtml(`Sure! ${DOC} Hope it helps.`), DOC);
  assert.throws(() => extractHtml('I cannot do that.'), /usable animation/);
  assert.equal(extractTitle(DOC), 'Summer Sale');
  assert.equal(extractTitle('<html></html>', 'fallback'), 'fallback');
});

test('prompts carry the format, preset and edit context', () => {
  const [system, user] = buildGenerateMessages({ prompt: 'SUMMER SALE intro', aspect: '9:16', duration: 8, style: 'neon' });
  assert.match(system.content, /width="1080" height="1920"/);
  assert.match(system.content, /window\.__render/);
  assert.match(system.content, /Neon:/);
  assert.match(system.content, /No images are available/);
  assert.match(user.content, /SUMMER SALE intro/);
  assert.match(user.content, /8 seconds/);

  const edit = buildEditMessages({ html: DOC, instruction: 'make it blue', aspect: '1:1', duration: 5, style: 'bold', image: { width: 400, height: 200 }, formatChanged: true });
  assert.match(edit[0].content, /window\.__assets\.image/);
  assert.match(edit[1].content, /make it blue/);
  assert.match(edit[1].content, /1080x1080/);
  assert.ok(edit[1].content.includes(DOC));
});

test('prepared documents start with the network-blocking CSP and include the harness', () => {
  const doc = prepareDocument(
    DOC.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src *"><base href="https://evil.example/">'),
    { aspect: '16:9', duration: 6, imageDataUrl: 'data:image/png;base64,AAAA</script>' },
  );
  const cspIndex = doc.indexOf(`content="${CONTENT_SECURITY_POLICY}"`);
  assert.ok(cspIndex > 0 && cspIndex < doc.indexOf('<html>'));
  assert.equal((doc.match(/Content-Security-Policy/g) || []).length, 1);
  assert.ok(!doc.includes('<base'));
  assert.ok(doc.startsWith('<!DOCTYPE html>'));
  assert.equal((doc.match(/<!DOCTYPE/gi) || []).length, 1);
  // The attached image can't break out of its script tag.
  assert.ok(!doc.includes('AAAA</script>'));
  assert.ok(doc.includes('"autoExport":false'));
  assert.ok(doc.indexOf('captureStream') > doc.indexOf('window.__render=function'));
  assert.ok(doc.indexOf('captureStream') < doc.indexOf('</body>'));
});
