'use strict';

const DEFAULT_FEEDS = [
  'https://www.mural.com.mx/rss/portada.xml',
  'https://diario.mx/jrz/media/sitemaps/rss.xml',
  'https://editorial.aristeguinoticias.com/feed/',
  'https://editorial.aristeguinoticias.com/category/mundo/feed/',
  'https://editorial.aristeguinoticias.com/category/aristegui-en-vivo/enterate/feed',
  'http://imparcialoaxaca.mx/feed/',
  'https://www.elsiglodetorreon.com.mx/index.xml',
  'https://www.elnorte.com/rss/portada.xml',
  'http://expresochiapas.com/noticias/feed/',
  'https://mexiconewsdaily.com/feed/',
  'https://feedx.net/rss/ap.xml',
  'https://feeds.bbci.co.uk/news/rss.xml',
  'http://expansion.mx/rss',
  'http://expansion.mx/rss/economia',
  'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/mexico/portada',
  'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/tecnologia/portada',
  'https://feeds.elpais.com/mrss-s/list/ep/site/elpais.com/section/videos',
  'http://www.bbc.co.uk/mundo/index.xml',
  'http://www.bbc.co.uk/mundo/ultimas_noticias/index.xml',
  'http://www.bbc.co.uk/mundo/temas/internacional/index.xml',
  'http://www.bbc.co.uk/mundo/temas/america_latina/index.xml'
];
const KEY_FEEDS = 'rss_feeder_v3_feeds';
const KEY_THEME = 'rss_theme';
const KEY_DATES = 'rss_feeder_v3_dates';
const KEY_LIMIT = 'rss_feeder_v3_limit';

const $ = (selector) => document.querySelector(selector);
const dom = {
  list: $('#articleList'), status: $('#statusBox'), errors: $('#errorBox'),
  errorList: $('#errorList'), errorSummary: $('#errorSummary'),
  empty: $('#emptyState'), result: $('#resultsLabel'), updated: $('#updatedAt'),
  input: $('#feedInput'), feedList: $('#feedList'), sourceCount: $('#sourceCount'),
  search: $('#searchInput'), source: $('#sourceFilter'), limit: $('#limitFilter'),
  dates: $('#showDates'), theme: $('#themeButton'), refresh: $('#refreshButton')
};

const stored = (key) => {
  try { return localStorage.getItem(key); } catch { return null; }
};
const save = (key, value) => {
  try { localStorage.setItem(key, value); } catch { /* navegación privada */ }
};
const parseUrl = (value) => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url;
  } catch { return null; }
};
const unique = (values) => [...new Set(values)];

let feeds;
try {
  const value = JSON.parse(stored(KEY_FEEDS));
  feeds = Array.isArray(value) ? unique(value.filter((url) => typeof url === 'string' && parseUrl(url))).slice(0, 100) : [...DEFAULT_FEEDS];
} catch {
  feeds = [...DEFAULT_FEEDS];
}
let articles = [];
let errors = [];
let requestVersion = 0;
let loading = false;

const lastLimit = stored(KEY_LIMIT);
if (['50', '100', '200'].includes(lastLimit)) dom.limit.value = lastLimit;
dom.dates.checked = stored(KEY_DATES) !== 'false';

function setTheme(dark) {
  document.body.dataset.theme = dark ? 'dark' : 'light';
  dom.theme.firstChild.textContent = dark ? '☼ ' : '☾ ';
  dom.theme.setAttribute('aria-label', dark ? 'Activar tema claro' : 'Activar tema oscuro');
  save(KEY_THEME, dark ? 'dark' : 'light');
}
setTheme(stored(KEY_THEME) === 'dark');

function setNotice(message, show = true) {
  dom.status.textContent = message;
  dom.status.hidden = !show;
}

function renderFeeds() {
  dom.sourceCount.textContent = String(feeds.length);
  dom.feedList.replaceChildren();
  for (const url of feeds) {
    const item = document.createElement('li');
    item.className = 'feed-item';
    const label = document.createElement('span');
    label.className = 'feed-label';
    label.textContent = url;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'remove-feed';
    button.textContent = '×';
    button.setAttribute('aria-label', 'Eliminar fuente ' + url);
    button.addEventListener('click', () => {
      feeds = feeds.filter((feed) => feed !== url);
      save(KEY_FEEDS, JSON.stringify(feeds));
      renderFeeds();
      loadNews();
    });
    item.append(label, button);
    dom.feedList.append(item);
  }
  const selected = dom.source.value;
  dom.source.replaceChildren(new Option('Todas las fuentes', ''));
  for (const url of feeds) {
    let name;
    try { name = new URL(url).hostname; } catch { name = url; }
    const fromArticle = articles.find((article) => article.feedUrl === url);
    dom.source.add(new Option(fromArticle?.feedTitle || name, url));
  }
  dom.source.value = feeds.includes(selected) ? selected : '';
}

function articleCard(article) {
  const card = document.createElement('article');
  card.className = 'article';

  const imageUrl = parseUrl(article.imageUrl);
  if (imageUrl) {
    const img = document.createElement('img');
    img.className = 'article-image';
    img.src = imageUrl.href;
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove(), { once: true });
    card.append(img);
  }

  const body = document.createElement('div');
  body.className = 'article-body';
  const source = document.createElement('span');
  source.className = 'article-source';
  source.textContent = article.feedTitle || 'RSS';
  const title = document.createElement('h3');
  title.className = 'article-title';
  const titleLink = document.createElement('a');
  titleLink.href = article.link;
  titleLink.rel = 'noopener noreferrer';
  titleLink.target = '_blank';
  titleLink.textContent = article.title || 'Sin título';
  title.append(titleLink);
  body.append(source, title);

  if (article.summary) {
    const summary = document.createElement('p');
    summary.className = 'article-summary';
    summary.textContent = article.summary;
    body.append(summary);
  }

  const meta = document.createElement('div');
  meta.className = 'article-meta';
  if (dom.dates.checked) {
    const date = document.createElement('time');
    date.textContent = article.publishedAt
      ? new Date(article.publishedAt).toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
      : 'Sin fecha';
    if (article.publishedAt) date.dateTime = article.publishedAt;
    meta.append(date);
  }
  const open = document.createElement('a');
  open.className = 'article-open';
  open.href = article.link;
  open.target = '_blank';
  open.rel = 'noopener noreferrer';
  open.textContent = 'Leer artículo ↗';
  meta.append(open);
  body.append(meta);
  card.append(body);
  return card;
}

function renderArticles() {
  const query = dom.search.value.trim().toLocaleLowerCase('es');
  const source = dom.source.value;
  const limit = Number(dom.limit.value) || 100;
  const filtered = articles.filter((article) => {
    if (source && article.feedUrl !== source) return false;
    if (!query) return true;
    return [article.title, article.summary, article.feedTitle].some((field) =>
      String(field || '').toLocaleLowerCase('es').includes(query)
    );
  });
  const shown = filtered.slice(0, limit);
  dom.list.replaceChildren();
  const fragment = document.createDocumentFragment();
  for (const article of shown) fragment.append(articleCard(article));
  dom.list.append(fragment);
  dom.result.textContent = shown.length + ' de ' + filtered.length + ' noticias' +
    (articles.length !== filtered.length ? ' · ' + articles.length + ' recopiladas' : '');
  dom.empty.hidden = loading || shown.length > 0;
}

function renderErrors() {
  dom.errorList.replaceChildren();
  dom.errors.hidden = errors.length === 0;
  dom.errorSummary.textContent = errors.length + ' fuente(s) no respondieron';
  for (const error of errors) {
    const item = document.createElement('li');
    item.textContent = error.url + ': ' + error.error;
    dom.errorList.append(item);
  }
}

function deduplicate(items) {
  const seen = new Set();
  return items.filter((article) => {
    const link = parseUrl(article?.link);
    if (!link) return false;
    const key = link.href.replace(/#.*$/, '').toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => {
    const dateA = Date.parse(a.publishedAt || '') || 0;
    const dateB = Date.parse(b.publishedAt || '') || 0;
    return dateB - dateA;
  });
}

async function loadNews() {
  const version = ++requestVersion;
  loading = true;
  dom.refresh.disabled = true;
  articles = [];
  errors = [];
  renderFeeds();
  renderArticles();
  renderErrors();

  if (!feeds.length) {
    loading = false;
    dom.refresh.disabled = false;
    setNotice('Agrega al menos una fuente RSS para comenzar.');
    return;
  }
  const batches = [];
  for (let i = 0; i < feeds.length; i += 5) batches.push(feeds.slice(i, i + 5));
  let nextBatch = 0;
  let processed = 0;
  setNotice('Consultando ' + feeds.length + ' fuentes…');

  async function worker() {
    while (nextBatch < batches.length && version === requestVersion) {
      const batch = batches[nextBatch++];
      try {
        const response = await fetch('/.netlify/functions/rss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: batch }),
          signal: AbortSignal.timeout(25000)
        });
        if (!response.ok) throw new Error('Error del servicio (' + response.status + ')');
        const result = await response.json();
        if (version !== requestVersion) return;
        articles.push(...(Array.isArray(result.articles) ? result.articles : []));
        errors.push(...(Array.isArray(result.errors) ? result.errors : []));
      } catch (error) {
        if (version !== requestVersion) return;
        errors.push(...batch.map((url) => ({ url, error: error.message || 'Error de conexión' })));
      }
      processed += batch.length;
      if (version === requestVersion) {
        articles = deduplicate(articles);
        setNotice('Consultadas ' + processed + ' de ' + feeds.length + ' fuentes…');
        renderArticles();
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(2, batches.length) }, worker));
  if (version !== requestVersion) return;
  loading = false;
  dom.refresh.disabled = false;
  articles = deduplicate(articles);
  renderFeeds();
  renderArticles();
  renderErrors();
  setNotice(articles.length ? '' : 'No se recibieron noticias. Revisa los detalles de las fuentes.', !articles.length);
  dom.updated.textContent = 'Actualizado: ' + new Date().toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

$('#addFeedForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const provided = unique(dom.input.value.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean));
  const invalid = provided.filter((value) => !parseUrl(value));
  if (invalid.length) {
    setNotice('Estas direcciones no son URL HTTP(S) válidas: ' + invalid.join(', '));
    return;
  }
  const additions = provided.filter((value) => !feeds.includes(value));
  if (feeds.length + additions.length > 100) {
    setNotice('Puedes guardar hasta 100 fuentes. Elimina alguna antes de agregar más.');
    return;
  }
  if (!additions.length) {
    setNotice('Esas fuentes ya están agregadas.');
    return;
  }
  feeds.push(...additions);
  save(KEY_FEEDS, JSON.stringify(feeds));
  dom.input.value = '';
  renderFeeds();
  loadNews();
});
$('#resetFeeds').addEventListener('click', () => {
  if (!confirm('¿Restablecer las 21 fuentes originales? Se perderán tus cambios en este navegador.')) return;
  feeds = [...DEFAULT_FEEDS];
  save(KEY_FEEDS, JSON.stringify(feeds));
  renderFeeds();
  loadNews();
});
$('#clearFilters').addEventListener('click', () => {
  dom.search.value = '';
  dom.source.value = '';
  renderArticles();
});
dom.search.addEventListener('input', renderArticles);
dom.source.addEventListener('change', renderArticles);
dom.limit.addEventListener('change', () => { save(KEY_LIMIT, dom.limit.value); renderArticles(); });
dom.dates.addEventListener('change', () => { save(KEY_DATES, String(dom.dates.checked)); renderArticles(); });
dom.theme.addEventListener('click', () => setTheme(document.body.dataset.theme !== 'dark'));
dom.refresh.addEventListener('click', loadNews);

renderFeeds();
loadNews();
