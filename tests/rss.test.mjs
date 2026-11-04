import test from 'node:test';
import assert from 'node:assert/strict';
import { parseArticles, validateFeedUrl } from '../netlify/functions/rss.mjs';

test('rechaza protocolos y servidores locales', () => {
  assert.throws(() => validateFeedUrl('file:///etc/passwd'));
  assert.throws(() => validateFeedUrl('http://localhost/feed.xml'));
  assert.throws(() => validateFeedUrl('http://127.0.0.1/feed'));
  assert.throws(() => validateFeedUrl('https://user:password@example.com/feed'));
  assert.equal(validateFeedUrl('https://example.com/rss').hostname, 'example.com');
});

test('interpreta RSS 2.0 y limpia etiquetas HTML', () => {
  const xml = [
    '<?xml version="1.0"?><rss version="2.0"><channel>',
    '<title>Noticias</title><item><title>Nota de prueba</title>',
    '<link>https://news.example.org/1</link>',
    '<description><![CDATA[<p>Resumen <b>claro</b>.</p>]]></description>',
    '<pubDate>Wed, 04 Nov 2026 11:00:00 GMT</pubDate>',
    '</item></channel></rss>'
  ].join('');
  const articles = parseArticles(xml, 'https://news.example.org/feed');
  assert.equal(articles.length, 1);
  assert.equal(articles[0].title, 'Nota de prueba');
  assert.equal(articles[0].summary, 'Resumen claro .');
  assert.equal(articles[0].feedTitle, 'Noticias');
  assert.equal(articles[0].publishedAt, '2026-11-04T11:00:00.000Z');
});

test('interpreta Atom con enlaces de atributo href', () => {
  const xml = [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<feed xmlns="http://www.w3.org/2005/Atom">',
    '<title>Ejemplo Atom</title><entry><title>Atom uno</title>',
    '<link rel="alternate" href="https://example.org/post"/>',
    '<updated>2026-11-04T12:00:00Z</updated>',
    '<summary>Texto de la noticia</summary></entry></feed>'
  ].join('');
  const articles = parseArticles(xml, 'https://example.org/feed.xml');
  assert.equal(articles.length, 1);
  assert.equal(articles[0].link, 'https://example.org/post');
  assert.equal(articles[0].summary, 'Texto de la noticia');
});

test('rechaza documentos que no son feeds', () => {
  assert.throws(() => parseArticles('<root/>', 'https://example.org/rss'));
});
