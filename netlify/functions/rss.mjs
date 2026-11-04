import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const MAX_URLS = 5;
const MAX_FEED_BYTES = 1_500_000;
const MAX_ENTRIES_PER_FEED = 35;
const TIMEOUT_MS = 9000;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: false
});

function asArray(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function textOf(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return textOf(value[0]);
  if (typeof value === 'object') return textOf(value['#text'] ?? value['#cdata'] ?? '');
  return '';
}

function stripMarkup(value) {
  return textOf(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function safeHttpUrl(value, base) {
  try {
    const url = new URL(String(value), base);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.username || url.password) return '';
    return url.href;
  } catch {
    return '';
  }
}

export function validateFeedUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('URL demasiado larga o inválida');
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Solo se permiten direcciones HTTP y HTTPS');
  if (url.username || url.password) throw new Error('No se permiten credenciales en la URL');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    isIP(host) ||
    !host.includes('.') ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.endsWith('.test') ||
    host.endsWith('.invalid')
  ) {
    throw new Error('El servidor de la fuente no está permitido');
  }
  if (url.port && !['80', '443'].includes(url.port)) {
    throw new Error('El puerto de la fuente no está permitido');
  }
  return url;
}

function isPublicAddress(address, family) {
  if (family === 4) {
    const p = address.split('.').map(Number);
    const a = p[0], b = p[1], c = p[2];
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && (b === 168 || (b === 0 && c === 0) || (b === 0 && c === 2))) return false;
    if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
    if (a === 203 && b === 0 && c === 113) return false;
    return true;
  }
  if (family === 6) {
    const s = address.toLowerCase();
    return s !== '::' && s !== '::1' &&
      !s.startsWith('fc') && !s.startsWith('fd') &&
      !/^fe[89ab]/.test(s) && !s.startsWith('ff') &&
      !s.startsWith('::ffff:') && !s.startsWith('2001:db8:');
  }
  return false;
}

async function assertPublicHost(url) {
  const addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || !addresses.every((item) => isPublicAddress(item.address, item.family))) {
    throw new Error('El dominio resuelve a una dirección no permitida');
  }
}

async function fetchXml(startUrl) {
  let url = validateFeedUrl(startUrl);
  for (let redirect = 0; redirect < 4; redirect += 1) {
    await assertPublicHost(url);
    const response = await fetch(url, {
      headers: {
        'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.4',
        'User-Agent': 'RSS-Feeder-Netlify/0.1 (+https://github.com/raulcamaracarreon/rss-feeder-netlify)'
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });

    if (response.status >= 300 && response.status < 400) {
      const target = response.headers.get('location');
      if (!target) throw new Error('Redirección sin destino');
      url = validateFeedUrl(new URL(target, url).href);
      continue;
    }
    if (!response.ok) throw new Error('Respuesta HTTP ' + response.status);

    const length = Number(response.headers.get('content-length') || '0');
    if (length > MAX_FEED_BYTES) throw new Error('La fuente supera el tamaño permitido');
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > MAX_FEED_BYTES) {
        await response.body.cancel().catch(() => {});
        throw new Error('La fuente supera el tamaño permitido');
      }
      chunks.push(chunk);
    }
    const xml = Buffer.concat(chunks).toString('utf8');
    if (XMLValidator.validate(xml) !== true) throw new Error('La fuente no contiene XML válido');
    return { xml, finalUrl: url.href };
  }
  throw new Error('Demasiadas redirecciones');
}

function pickLink(entry) {
  const links = asArray(entry.link);
  for (const link of links) {
    if (typeof link === 'string') return link;
    if (link && typeof link === 'object' && link['@_href'] &&
      (!link['@_rel'] || link['@_rel'] === 'alternate')) {
      return link['@_href'];
    }
  }
  return textOf(entry.guid);
}

function pickImage(entry, base) {
  const items = [
    ...asArray(entry['media:thumbnail']),
    ...asArray(entry['media:content']),
    ...asArray(entry.enclosure)
  ];
  for (const item of items) {
    const value = item?.['@_url'] || item?.url || '';
    const url = safeHttpUrl(value, base);
    if (url && (!item?.['@_type'] || String(item['@_type']).startsWith('image/'))) return url;
  }
  const html = textOf(entry['content:encoded'] ?? entry.description ?? entry.summary ?? entry.content);
  const match = html.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i);
  return match ? safeHttpUrl(match[1].replace(/&amp;/g, '&'), base) : '';
}

export function parseArticles(xml, feedUrl) {
  const parsed = parser.parse(xml);
  const channel = parsed?.rss?.channel || parsed?.['rdf:RDF'] || null;
  const atom = parsed?.feed || null;
  if (!channel && !atom) throw new Error('El documento no es un RSS o Atom reconocido');

  const source = stripMarkup(channel?.title ?? atom?.title) || new URL(feedUrl).hostname;
  const entries = asArray(channel?.item ?? atom?.entry).slice(0, MAX_ENTRIES_PER_FEED);
  const articles = [];

  for (const entry of entries) {
    const link = safeHttpUrl(pickLink(entry), feedUrl);
    const title = stripMarkup(entry?.title) || 'Sin título';
    if (!link) continue;

    const summaryRaw = entry?.description ?? entry?.summary ?? entry?.['content:encoded'] ?? entry?.content ?? '';
    const publishedRaw = textOf(entry?.pubDate ?? entry?.published ?? entry?.updated ?? entry?.['dc:date']);
    const parsedDate = publishedRaw ? Date.parse(publishedRaw) : NaN;
    const publishedAt = Number.isFinite(parsedDate) ? new Date(parsedDate).toISOString() : null;

    articles.push({
      title: title.slice(0, 300),
      link,
      summary: stripMarkup(summaryRaw).slice(0, 1000),
      feedUrl,
      feedTitle: source.slice(0, 180),
      publishedAt,
      imageUrl: pickImage(entry, feedUrl)
    });
  }
  return articles;
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Método no permitido' }, { status: 405, headers: { 'Allow': 'POST' } });
  }
  let data;
  try {
    data = await request.json();
  } catch {
    return Response.json({ error: 'JSON inválido' }, { status: 400 });
  }
  if (!Array.isArray(data?.urls) || data.urls.length < 1 || data.urls.length > MAX_URLS) {
    return Response.json({ error: 'Envía de 1 a 5 URL por solicitud' }, { status: 400 });
  }
  const uniqueUrls = [...new Set(data.urls)];
  const results = await Promise.all(uniqueUrls.map(async (url) => {
    try {
      validateFeedUrl(url);
      const { xml, finalUrl } = await fetchXml(url);
      return { url, articles: parseArticles(xml, finalUrl).map((item) => ({ ...item, feedUrl: url })) };
    } catch (error) {
      return { url: String(url).slice(0, 180), error: error instanceof Error ? error.message : 'Error desconocido', articles: [] };
    }
  }));
  return Response.json({
    articles: results.flatMap((item) => item.articles),
    errors: results.filter((item) => item.error).map(({ url, error }) => ({ url, error })),
    processed: results.length
  }, { headers: { 'Cache-Control': 'no-store' } });
}
