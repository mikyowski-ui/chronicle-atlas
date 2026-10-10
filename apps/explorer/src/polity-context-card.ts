import { describeInspectorFeature, safeArticleURL, type InspectorContext } from './dossier-inspector.ts';
import { formatFixtureYear } from './date-label.ts';
import { formatNavigationDate } from './time-entry.ts';
import { eventDay, type HistoricalContextProfile } from './historical-context.ts';
import { activeCapitals, CAPITAL_SOURCES, formatHistoryYear, toAstronomicalYear, toHistoricalYear, type StateHistory } from './state-histories.ts';

/** Values arrive from an admitted observation or a precomputed lookup, never client geometry. */
export interface PolityCardMetric {
  label: string;
  value: string;
  qualifier?: string;
  sourceLabel?: string;
  sourceURL?: string;
}

export interface PolityCardContext extends InspectorContext {
  historicalContext?: HistoricalContextProfile;
  stateHistory?: StateHistory;
  metrics?: readonly PolityCardMetric[];
  dossierAvailable?: boolean;
}

export interface PolityCardCallbacks {
  onNavigate: (time: number, entityId?: string, name?: string) => void;
  onEvidence?: () => void;
  onDossier?: () => void;
  onFocusTimeline?: () => void;
}

/** Image bytes must be included in this candidate. Remote images cannot track map selections. */
export function safeContextImageURL(value: string, baseURL: string): string {
  if (!value || value.length > 1024) throw new Error('Invalid context image.');
  const base = new URL(baseURL), url = new URL(value, base);
  if (url.origin !== base.origin || !['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      !/\.(?:avif|gif|jpe?g|png|webp)$/i.test(url.pathname) || url.search || url.hash) throw new Error('Context images must be local assets.');
  return url.href;
}

/** Enrichment never turns a cultural polygon or an unrepresented selection into a state. */
export function eligibleCardProfile(context: PolityCardContext): HistoricalContextProfile | undefined {
  if (!context.selection || context.selectionRepresented === false || context.representation === 'missing' ||
      context.displayedTime === null || context.feature?.kind !== 'political-association') return undefined;
  const profile = context.historicalContext;
  if (!profile) return undefined;
  const names = [context.selection.name, context.feature.sourceName].map(name => name.trim().toLocaleLowerCase('en'));
  if (!profile.names.some(name => names.includes(name.trim().toLocaleLowerCase('en')))) return undefined;
  const year = new Date(context.displayedTime * 86400000).getUTCFullYear();
  return profile.fromYear <= year && year <= profile.toYear && profile.observationYears.includes(year) ? profile : undefined;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag); element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}
function action(label: string, callback: () => void, className = ''): HTMLButtonElement {
  const button = el('button', className, label); button.type = 'button'; button.addEventListener('click', callback); return button;
}
function external(text: string, value: string): HTMLAnchorElement | null {
  try {
    const link = el('a', 'polity-context-link', text); link.href = safeArticleURL(value);
    link.target = '_blank'; link.rel = 'noopener noreferrer'; return link;
  } catch { return null; }
}
function setText(element: HTMLElement, text: string): void { if (element.textContent !== text) element.textContent = text; }

/** A selected entity's dated context. Cursor-only updates preserve the DOM, scroll and disclosures. */
export class PolityContextCard {
  private key = '';
  private entityId = '';
  private browsing: HTMLElement;
  private observed: HTMLElement;
  private body: HTMLElement;

  constructor(private readonly host: HTMLElement, private readonly callbacks: PolityCardCallbacks) {
    host.classList.add('polity-context-card');
    const dates = el('div', 'polity-context-dates');
    this.browsing = el('p', 'polity-context-browsing');
    this.observed = el('p', 'polity-context-observed');
    dates.append(this.browsing, this.observed);
    this.body = el('div', 'polity-context-body');
    host.replaceChildren(dates, this.body); host.hidden = true;
  }

  update(context: PolityCardContext): void {
    const selected = context.selection;
    this.host.hidden = !selected;
    if (!selected) { this.key = ''; this.entityId = ''; this.body.replaceChildren(); return; }
    const represented = context.selectionRepresented !== false && context.representation !== 'missing';
    const profile = eligibleCardProfile(context);
    const history = context.stateHistory;
    const capitals = history ? activeCapitals(history.id, new Date(context.requestedTime * 86400000).getUTCFullYear()) : [];
    const browsingYear = toHistoricalYear(new Date(context.requestedTime * 86400000).getUTCFullYear());
    const lifeStatus = history ? browsingYear < history.fromYear ? 'before' : browsingYear > history.toYear ? 'after' : 'during' : '';
    this.host.dataset.entityId = selected.entityId;
    this.host.dataset.contextId = profile?.id ?? '';
    this.host.dataset.historyId = history?.id ?? '';
    this.host.dataset.representation = context.representation;
    this.host.dataset.kind = context.feature?.kind ?? 'unknown';
    setText(this.browsing, `Browsing ${formatNavigationDate(context.requestedTime)}`);
    setText(this.observed, !represented || context.displayedTime === null ? 'Selection retained · no representation at this date' :
      `${context.pending ? 'Loaded observation' : context.representation === 'reference' ? 'Reference observation' : 'Map observation'} · ${formatFixtureYear(context.displayedTime)}`);
    this.observed.title = context.representation === 'reference' ? 'This earlier observation is dated context, not a border assertion at the browsing date.' : '';

    // Only semantic scene/content changes rebuild the card. In particular, requestedTime and
    // pending are absent: continuous seeking must not collapse an open evidence disclosure.
    const key = JSON.stringify([selected.entityId, selected.name, represented, context.displayedTime,
      context.edition, context.feature, profile?.id, history?.id, lifeStatus, capitals.map(capital => [capital.id, capital.period.from, capital.period.to]), context.metrics, context.dossierAvailable]);
    if (key === this.key) return;
    this.key = key;
    const changedEntity = this.entityId !== selected.entityId; this.entityId = selected.entityId;
    this.body.replaceChildren();
    if (changedEntity) { this.host.scrollTop = 0; if (this.host.parentElement) this.host.parentElement.scrollTop = 0; }

    const title = el('h2', 'polity-context-title', history?.title ?? profile?.title ?? selected.name);
    const heading = el('header', 'polity-context-heading');
    heading.append(el('p', 'polity-context-kicker', history?.periodLabel ?? profile?.periodLabel ?? (represented ? 'Selected historical entity' : 'Selected entity')), title);
    this.body.append(heading);
    if (history && lifeStatus !== 'during') this.body.append(el('p', 'polity-context-qualifier', lifeStatus === 'before'
      ? 'Browsing before this state or phase began. Its history is retained for reference.'
      : 'Browsing after this state or phase ended. Its history is retained for reference.'));
    if (history) this.renderHistory(history, capitals);

    if (!represented) {
      this.body.append(el('p', 'polity-context-lead', 'Your selection is kept while you explore another date.'));
      this.renderActions(false); this.renderEvidence(context, profile); return;
    }

    if (context.feature) {
      const meaning = describeInspectorFeature(context.feature);
      const badge = el('p', 'polity-context-status', meaning.type);
      badge.title = meaning.meaning; this.body.append(badge);
      if (context.feature.kind !== 'political-association' && context.feature.kind !== 'synthetic')
        this.body.append(el('p', 'polity-context-meaning', meaning.meaning));
    }
    if (profile && !history) {
      this.body.append(el('p', 'polity-context-lead', profile.summary));

    }

    const metrics: PolityCardMetric[] = [...(context.metrics ?? [])];
    for (const metric of profile?.metrics ?? []) {
      const source = profile?.sources.find(item => item.id === metric.sourceId);
      metrics.push({ label: metric.label, value: metric.value, qualifier: metric.qualifier,
        sourceLabel: source?.publisher, sourceURL: source?.url });
    }
    if (metrics.length) this.renderMetrics(metrics.slice(0, 6));
    if (profile?.image) this.renderImage(profile);
    if (profile?.institutions.length) this.renderStatements('Government & society', profile.institutions);
    if (profile?.changes.length && !history) this.renderStatements('In this period', profile.changes);
    if (profile?.succession && !history) this.renderSuccession(profile);
    this.renderActions(context.dossierAvailable === true);
    this.renderEvidence(context, profile);
  }

  private renderHistory(history: StateHistory, capitals: ReturnType<typeof activeCapitals>): void {
    this.body.append(el('p', 'polity-context-lead', history.summary));
    const section = el('section', 'polity-context-section');
    section.append(el('h3', '', 'Continuity & capitals'), el('p', '', history.continuity));
    for (const capital of capitals) {
      section.append(el('p', 'polity-context-capital', `★ ${capital.name} · ${formatHistoryYear(capital.period.from)}–${formatHistoryYear(capital.period.to)}`));
      if (capital.period.note) section.append(el('p', 'polity-context-qualifier', capital.period.note));
      const source = CAPITAL_SOURCES.find(source => source.id === capital.period.sourceId);
      const link = source && external(source.title, source.url); if (link) section.append(link);
    }
    if (!capitals.length) section.append(el('p', 'polity-context-qualifier', 'No capital tenure is documented here for the browsing date.'));
    this.body.append(section);
    if (history.transitions.length) {
      const lifecycle = el('details', 'polity-context-lifecycle'); lifecycle.open = true;
      lifecycle.append(el('summary', '', 'From formation to transition'));
      const list = el('ol');
      for (const transition of history.transitions) {
        const item = el('li');
        item.append(action(`${transition.dateLabel} · ${transition.title}`, () => this.callbacks.onNavigate(eventDay(toAstronomicalYear(transition.year)))), el('p', '', transition.summary));
        list.append(item);
      }
      lifecycle.append(list); this.body.append(lifecycle);
    }
  }

  private renderImage(profile: HistoricalContextProfile): void {
    const image = profile.image;
    if (!image) return;
    let src: string;
    try { src = safeContextImageURL(image.src, document.baseURI); } catch { return; }
    const figure = el('figure', 'polity-context-figure');
    const picture = el('img'); picture.src = src; picture.alt = image.alt;
    picture.loading = 'lazy'; picture.decoding = 'async'; picture.width = 640; picture.height = 400;
    // Keep an unavailable image out of the card rather than displaying a broken placeholder.
    picture.addEventListener('error', () => figure.remove(), { once: true });
    const caption = el('figcaption'); caption.append(el('span', '', image.caption));
    const credit = external(`${image.credit} ↗`, image.sourceUrl);
    if (credit) { credit.title = image.rights; caption.append(credit); }
    else caption.append(el('span', 'polity-context-image-credit', image.credit));
    figure.append(picture, caption); this.body.append(figure);
  }

  private renderMetrics(metrics: readonly PolityCardMetric[]): void {
    const list = el('dl', 'polity-context-metrics'); list.setAttribute('aria-label', 'Dated quantitative information');
    for (const metric of metrics) {
      const row = el('div', 'polity-context-metric');
      const value = el('dd', '', metric.value);
      row.append(el('dt', '', metric.label), value);
      if (metric.qualifier) row.append(el('p', 'polity-context-qualifier', metric.qualifier));
      if (metric.sourceURL) { const link = external(metric.sourceLabel ?? 'Source ↗', metric.sourceURL); if (link) row.append(link); }
      else if (metric.sourceLabel) row.append(el('small', '', metric.sourceLabel));
      list.append(row);
    }
    this.body.append(list);
  }

  private renderStatements(label: string, statements: readonly string[]): void {
    const section = el('section', 'polity-context-section'); section.append(el('h3', '', label));
    for (const statement of statements.slice(0, 3)) section.append(el('p', '', statement));
    this.body.append(section);
  }

  private renderSuccession(profile: HistoricalContextProfile): void {
    const succession = profile.succession;
    if (!succession) return;
    const section = el('section', 'polity-context-section polity-context-succession');
    section.append(el('h3', '', 'What follows'), el('p', 'polity-context-next-date', succession.dateLabel),
      el('h4', '', succession.label), el('p', '', succession.summary));
    const targets = el('div', 'polity-context-next-actions');
    for (const target of succession.targets.slice(0, 3)) {
      const time = eventDay(target.year);
      targets.append(action(`${target.name} · ${formatFixtureYear(time)} →`, () => this.callbacks.onNavigate(time, target.entityId, target.name)));
    }
    if (targets.childElementCount) {
      section.append(el('p', 'polity-context-qualifier', 'Explore a later source observation'), targets);
    }
    this.body.append(section);
  }

  private renderActions(dossierAvailable: boolean): void {
    const actions = el('div', 'polity-context-actions');
    if (this.callbacks.onFocusTimeline) actions.append(action('Explore its timeline', () => this.callbacks.onFocusTimeline?.(), 'polity-context-primary'));
    if (dossierAvailable && this.callbacks.onDossier) actions.append(action('Read dated study', () => this.callbacks.onDossier?.()));
    if (actions.childElementCount) this.body.append(actions);
  }

  private renderEvidence(context: PolityCardContext, profile: HistoricalContextProfile | undefined): void {
    const details = el('details', 'polity-context-evidence'); details.append(el('summary', '', 'Sources & interpretation'));
    if (context.feature) {
      const meaning = describeInspectorFeature(context.feature);
      details.append(el('p', 'polity-context-evidence-status', meaning.status), el('p', '', meaning.meaning));
      const identity = el('p', 'polity-context-source-identity', `${context.feature.sourceTitle} · ${context.feature.attribution}`);
      details.append(identity);
      if (context.feature.datePrecision) details.append(el('p', '', `Map precision: ${context.feature.datePrecision}.`));
      if (context.feature.classificationNote) details.append(el('p', '', context.feature.classificationNote));
    }
    if (profile) {
      details.append(el('p', '', 'The dated reading below is separate from the source-attributed map. It does not independently certify the mapped boundaries.'));
      const list = el('ul');
      for (const source of profile.sources) {
        const link = external(source.title, source.url); if (!link) continue;
        const item = el('li'); item.append(link, el('span', '', ` · ${source.publisher}`)); list.append(item);
      }
      details.append(list);
      if (profile.image) details.append(el('p', '', `Image: ${profile.image.credit}. ${profile.image.rights}.`));
    }
    if (context.stateHistory) {
      details.append(el('p', '', 'This state history describes its researched lifetime. Map outlines remain tied to their separate source observations.'));
      const list = el('ul');
      for (const source of context.stateHistory.sources) { const link = external(source.title, source.url); if (link) { const item = el('li'); item.append(link, el('span', '', ` · ${source.publisher}`)); list.append(item); } }
      details.append(list);
    }
    if (this.callbacks.onEvidence) details.append(action('Inspect map evidence', () => this.callbacks.onEvidence?.()));
    const edition = el('p', 'polity-context-edition', `Map edition · ${context.edition}`); details.append(edition);
    this.body.append(details);
  }

  destroy(): void { this.key = ''; this.host.replaceChildren(); this.host.hidden = true; }
}
