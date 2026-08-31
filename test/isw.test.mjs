// ISW daily assessment scraping — unit tests
// Uses Node.js built-in test runner (node:test) — no extra dependencies

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractKeyTakeaways } from '../apis/sources/isw.mjs';

describe('extractKeyTakeaways', () => {
  it('extracts bullet text when the <ul> immediately follows </strong>', () => {
    const html = '<p><strong>Key Takeaways:</strong><ul><li>First point.</li><li>Second point.</li></ul></p>';
    assert.deepEqual(extractKeyTakeaways(html), ['First point.', 'Second point.']);
  });

  it('extracts bullet text when a closing </p> sits between the heading and the list (real-world layout)', () => {
    const html = '<p><strong>Key Takeaways:</strong></p><ul>\n<li><strong>Bolded first point.</strong></li>\n<li>Second point with a <a href="#n1">footnote</a> link.</li></ul>';
    assert.deepEqual(extractKeyTakeaways(html), ['Bolded first point.', 'Second point with a footnote link.']);
  });

  it('returns an empty array when no Key Takeaways section is present', () => {
    assert.deepEqual(extractKeyTakeaways('<p>Nothing relevant here.</p>'), []);
  });
});
