import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const styles = [
  'src/glass-shell.css',
  'src/research/research.css',
  'src/research/semantic-view.css',
];

/**
 * Verify the narrow-view declaration policy against the actual application CSS.
 * This deliberately does not implement a browser layout engine: the enclosing
 * workspace bounds and the timeline's actual occupied height are test inputs.
 * The resulting geometry is algebra over declarations, not measured DOM bounds.
 * Exact selector groups have equal specificity; only their own source-order
 * cascade is considered. Evidence includes every winning declaration checked.
 */
export function checkNarrowLayoutPolicy({ app, width = 375, height = 812, parserModule }) {
  assert.equal(typeof app, 'string', 'app must be the Explorer directory');
  assert.equal(width, 375, 'This acceptance policy is specifically the 375px gate');
  assert.equal(height, 812, 'This acceptance policy uses the approved 812px fixture height');
  const appRoot = path.resolve(app);
  // The offline acceptance bundle supplies the same pinned PostCSS parser.
  // A source checkout reuses Vite's installed dependency without changing it.
  const viteRequire = parserModule ? null : createRequire(createRequire(path.join(appRoot, 'package.json')).resolve('vite/package.json'));
  const postcss = parserModule?.postcss ?? viteRequire('postcss');
  const parserVersion = parserModule?.version ?? viteRequire('postcss/package.json').version;
  const sources = styles.map((file) => {
    const bytes = readFileSync(path.join(appRoot, file));
    return {
      file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.byteLength,
      root: postcss.parse(bytes.toString('utf8'), { from: file }),
    };
  });
  const evidence = [];

  function mediaMatches(params, reducedMotion) {
    const normalized = params.replace(/\s+/g, '').toLowerCase();
    const max = /^\(max-width:(\d+)px\)$/.exec(normalized);
    if (max) return width <= Number(max[1]);
    const min = /^\(min-width:(\d+)px\)$/.exec(normalized);
    if (min) return width >= Number(min[1]);
    if (normalized === '(prefers-reduced-motion:reduce)') return reducedMotion;
    if (normalized === '(prefers-reduced-transparency:reduce)') return false;
    assert.fail(`Unreviewed media condition in selected rule: ${params}`);
  }

  function declarations(selector, reducedMotion = false) {
    const winners = new Map();
    for (const source of sources) {
      source.root.walkRules((rule) => {
        // PostCSS splits selector lists without breaking commas inside :is().
        if (!rule.selectors.includes(selector)) return;
        const media = [];
        for (let parent = rule.parent; parent && parent.type !== 'root'; parent = parent.parent) {
          assert.equal(parent.type, 'atrule', 'Unexpected nested CSS rule in policy scope');
          assert.equal(parent.name, 'media', 'Unreviewed conditional CSS rule in policy scope');
          media.unshift(parent.params);
        }
        if (!media.every((condition) => mediaMatches(condition, reducedMotion))) return;
        for (const node of rule.nodes) {
          assert.equal(node.type, 'decl', 'Selected policy rule must contain only declarations');
          const entry = {
            file: source.file,
            line: node.source.start.line,
            selector,
            media,
            property: node.prop,
            value: node.value,
            important: Boolean(node.important),
          };
          const previous = winners.get(node.prop);
          if (!previous?.important || entry.important) winners.set(node.prop, entry);
        }
      });
    }
    assert.ok(winners.size > 0, `No active source rule for ${selector}`);
    return winners;
  }

  function expect(selector, property, expected, { reducedMotion = false, important, media } = {}) {
    const actual = declarations(selector, reducedMotion).get(property);
    assert.ok(actual, `${selector} is missing ${property}`);
    assert.equal(actual.value.replace(/\s+/g, ''), expected.replace(/\s+/g, ''),
      `${selector} ${property} changed from the reviewed policy`);
    if (important !== undefined) assert.equal(actual.important, important, `${property} priority changed`);
    if (media) assert.ok(actual.media.some((value) => value.replace(/\s+/g, '') === media),
      `${selector} ${property} must come from ${media}`);
    evidence.push(actual);
    return actual.value;
  }

  const workspace = '.chronicle-glass .workspace';
  const panel = '.chronicle-glass .research-workspace';
  const mobile = { media: '(max-width:760px)' };
  expect(workspace, '--timeline-dock-height', '212px');
  expect(workspace, 'display', 'grid');
  expect(workspace, 'grid-template-rows', 'minmax(0,1fr) auto');
  expect(workspace, 'grid-template-columns', 'minmax(0,1fr)');
  expect('.chronicle-glass .workspace>#map', 'grid-row', '1');
  expect('.chronicle-glass .workspace>#map', 'min-width', '0');
  expect('.chronicle-glass .workspace>#map', 'min-height', '0');
  expect('.chronicle-glass .workspace>.transport', 'grid-row', '2');
  expect('.chronicle-glass .workspace>.transport', 'position', 'relative');
  expect('.chronicle-glass .workspace>.transport', 'width', '100%');
  expect('.chronicle-glass .workspace>.transport', 'box-sizing', 'border-box');
  expect(panel, 'position', 'absolute');
  expect(panel, 'top', '116px', mobile);
  expect(panel, 'left', '10px', mobile);
  expect(panel, 'width', 'calc(100% - 20px)', mobile);
  expect(panel, 'max-height', 'calc(100% - var(--timeline-dock-height) - 130px)', mobile);
  expect(panel, 'padding', '15px', mobile);
  expect(panel, 'border', '1px solid var(--edge)');
  expect(panel, 'box-sizing', 'border-box');
  expect(panel, 'overflow', 'auto');
  expect(panel, 'overscroll-behavior', 'contain');
  expect('.research-table-scroll', 'overflow', 'auto');
  expect('.research-table-scroll', 'max-height', '320px');
  expect('.research-table-scroll table', 'width', '100%');
  expect('.research-table-scroll table', 'min-width', '410px');
  expect('.research-evidence dl>div', 'grid-template-columns', '92px 1fr', mobile);
  expect('.research-evidence dl>div', 'gap', '8px', mobile);
  expect('.research-evidence dd', 'overflow-wrap', 'anywhere');
  expect('.semantic-catalogue dl>div', 'grid-template-columns', '88px minmax(0,1fr)',
    { media: '(max-width:440px)' });
  expect('.semantic-catalogue dl>div', 'gap', '7px', { media: '(max-width:440px)' });
  expect('.semantic-refine', 'display', 'flex');
  expect('.semantic-refine', 'flex-wrap', 'wrap');
  expect('.semantic-refine', 'gap', '8px');
  expect('.semantic-refine label', 'display', 'flex');
  expect('.semantic-refine label', 'flex-direction', 'column');
  expect('.semantic-refine label', 'min-width', '0');
  expect('.semantic-refine label', 'max-width', '100%');
  expect('.semantic-refine input', 'width', '92px');
  expect('.semantic-refine select', 'max-width', '230px');
  expect('.semantic-refine .semantic-note', 'flex-basis', '100%');
  for (const selector of ['.research-workspace .semantic-refine input', '.research-workspace .semantic-refine select']) {
    expect(selector, 'max-width', '100%');
    expect(selector, 'box-sizing', 'border-box');
  }
  expect('.research-examples', 'flex-wrap', 'wrap');
  expect('.research-examples', 'gap', '6px', mobile);
  expect('.chronicle-glass .research-examples button', 'min-width', '110px', mobile);
  expect('.research-map-actions', 'flex-wrap', 'wrap');
  for (const selector of ['.research-workspace *', '.research-map-overlay *', '.semantic-catalogue', '.semantic-catalogue *']) {
    const reduced = { reducedMotion: true, important: true, media: '(prefers-reduced-motion:reduce)' };
    expect(selector, 'animation', 'none', reduced);
    expect(selector, 'transition', 'none', reduced);
    expect(selector, 'scroll-behavior', 'auto', reduced);
  }

  const host = { x: 0, y: 56, width, height: height - 56, timelineDockHeight: 212 };
  const panelMaximum = {
    x: host.x + 10,
    y: host.y + 116,
    width: host.width - 20,
    maxHeight: host.height - host.timelineDockHeight - 130,
    padding: 15,
    border: 1,
  };
  const innerWidth = panelMaximum.width - 2 * (panelMaximum.padding + panelMaximum.border);
  const timelineTop = host.y + host.height - host.timelineDockHeight;
  const bottomAtMaximum = panelMaximum.y + panelMaximum.maxHeight;
  assert.ok(panelMaximum.x >= host.x && panelMaximum.x + panelMaximum.width <= host.x + host.width,
    'Panel declaration exceeds the assumed viewport horizontally');
  assert.ok(panelMaximum.maxHeight > 0, 'Assumed host leaves no panel height');
  assert.ok(bottomAtMaximum <= timelineTop, 'Panel declaration overlaps the assumed timeline');
  assert.ok(410 > innerWidth, 'The narrow table fixture must exercise the declared overflow policy');
  assert.ok(92 + 8 < innerWidth, 'Evidence columns have no remaining width');

  return {
    status: 'PASS',
    gate: '375px CSS declaration policy and approved mock geometry',
    evidenceType: 'parsed-source-policy-with-assumed-host-geometry',
    renderedLayoutVerified: false,
    parser: { name: 'postcss', version: parserVersion },
    viewport: { width, height },
    assumptions: {
      host,
      panelMode: 'normal research workspace, without research-map-mode',
      content: 'No font metrics, intrinsic content sizes, browser layout, or paint are simulated.',
      cascade: 'Exact-selector source-order declarations; all three files are parsed, not a general selector-matching engine.',
      timeline: '212px occupied height is an explicit fixture assumption, checked against the CSS default custom property.',
    },
    sources: sources.map(({ file, sha256, bytes }) => ({ file, sha256, bytes })),
    checkedDeclarations: evidence,
    calculations: {
      panelMaximum: { ...panelMaximum, right: panelMaximum.x + panelMaximum.width, bottom: bottomAtMaximum, innerWidth },
      timeline: { top: timelineTop, height: host.timelineDockHeight, gapFromPanelMaximum: timelineTop - bottomAtMaximum },
      table: { minimumWidth: 410, availableWidth: innerWidth, declaredHorizontalOverflow: 'auto', excessAtMinimum: 410 - innerWidth },
      evidenceColumns: { first: 92, gap: 8, remainingNominalWidth: innerWidth - 92 - 8 },
      catalogueColumns: { first: 88, gap: 7, remainingNominalWidth: innerWidth - 88 - 7 },
      refinement: { layout: 'wrapping flex row with column labels', labelMaximumWidth: innerWidth, inputDeclaredWidth: 92 },
    },
    limitations: [
      'A passing declaration policy does not certify a browser-rendered layout or accessibility.',
      'Actual timeline expansion, text shaping, native controls, clipping, and overflow require browser or device review.',
      'No screenshot, GPU behavior, or physical mobile measurement is produced by this verifier.',
    ],
  };
}
