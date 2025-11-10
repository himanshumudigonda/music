
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const NodeCache = require('node-cache');
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '600'); // seconds

const cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 120 });

async function fetchHTML(url) {
  const cached = cache.get(url);
  if (cached) return cached;
  const res = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  const html = res.data;
  cache.set(url, html);
  return html;
}

app.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.status(400).json({ error: 'q is required' });
    const url = `https://www.jiosaavn.com/search/${encodeURIComponent(q)}`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    const results = [];
    const scripts = $('script').get();
    for (let s of scripts) {
      const text = $(s).html() || '';
      if (text.includes('window.__PRELOADED_STATE__')) {
        const m = text.match(/window.__PRELOADED_STATE__\s*=\s*(\{.+\})\s*;?/s);
        if (m && m[1]) {
          try {
            const data = JSON.parse(m[1]);
            if (data.search && data.search.songs && data.search.songs.list) {
              for (const it of data.search.songs.list) {
                results.push({
                  id: it.id || '',
                  title: it.title || it.name || '',
                  subtitle: (it.more_info && it.more_info.singers) || it.subtitle || '',
                  image: it.image || (it.more_info && it.more_info.image) || '',
                  _source: 'jiosaavn',
                  raw: it
                });
              }
            }
          } catch(e){}
        }
      }
    }
    if (!results.length) {
      $('.song, .listSong, .song-list li').each((i, el) => {
        const title = $(el).find('.song-title, .u-color-txt_primary, .song-name').first().text().trim();
        const subtitle = $(el).find('.song-subtitle, .u-color-txt_secondary').first().text().trim();
        const image = $(el).find('img').attr('src') || $(el).find('img').attr('data-src') || '';
        const link = $(el).find('a[href*="/song/"]').attr('href') || '';
        const id = link.split('/song/')[1] || '';
        if (title) results.push({ id: id || (''+i), title, subtitle, image, _source: 'jiosaavn' });
      });
    }
    const seen = new Set(); const merged = [];
    for (const r of results) {
      const key = (r.title + '|' + (r.subtitle||'')).toLowerCase().replace(/[^a-z0-9]/g,'');
      if (!seen.has(key)) { seen.add(key); merged.push(r); }
      if (merged.length >= 50) break;
    }
    return res.json({ query: q, count: merged.length, results: merged });
  } catch (e) {
    console.error('Search error', e.message);
    return res.status(500).json({ error: 'Search failed', detail: e.message });
  }
});

app.get('/song/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const url = `https://www.jiosaavn.com/song/${encodeURIComponent(id)}`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    let metadata = null;
    $('script').each((i, s) => {
      const text = $(s).html() || '';
      if (text.includes('window.__PRELOADED_STATE__')) {
        const m = text.match(/window.__PRELOADED_STATE__\s*=\s*(\{.+\})\s*;?/s);
        if (m && m[1]) {
          try {
            const data = JSON.parse(m[1]);
            if (data.song) metadata = data.song;
            else if (data.songs) metadata = data.songs;
            else if (data.entities && data.entities.songs) metadata = data.entities.songs;
            else if (JSON.stringify(data).includes(id)) metadata = data;
          } catch(e){}
        }
      }
    });
    if (!metadata) {
      const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || '';
      const image = $('meta[property="og:image"]').attr('content') || '';
      const artist = $('h2, .song-artist, .u-color-txt_secondary').first().text().trim() || '';
      metadata = { id, title, image, artist };
    }
    const urls = [];
    const urlRegex2 = /https?:\/\/[^"'<>\s]+/g;
    const matches = html.match(urlRegex2) || [];
    for (const m of matches) {
      if (/\.(mp3|m4a|aac|opus|mp4)/i.test(m)) urls.push(m);
    }
    const uniqueUrls = Array.from(new Set(urls)).slice(0,5);
    const out = { id, metadata, stream_candidates: uniqueUrls };
    return res.json(out);
  } catch (e) {
    console.error('Song error', e.message);
    return res.status(500).json({ error: 'Song fetch failed', detail: e.message });
  }
});

app.get('/album/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const url = `https://www.jiosaavn.com/album/${encodeURIComponent(id)}`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || '';
    const image = $('meta[property="og:image"]').attr('content') || '';
    const tracks = [];
    $('.song, .listSong, .song-list li').each((i, el) => {
      const t = $(el).find('.song-title').text().trim() || $(el).find('.u-color-txt_primary').text().trim();
      const link = $(el).find('a[href*="/song/"]').attr('href') || '';
      const id2 = link.split('/song/')[1] || '';
      if (t) tracks.push({ id: id2, title: t });
    });
    return res.json({ id, title, image, tracks });
  } catch (e) {
    console.error('Album error', e.message);
    return res.status(500).json({ error: 'Album fetch failed', detail: e.message });
  }
});

app.get('/playlist/:id', async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: 'id required' });
    const url = `https://www.jiosaavn.com/playlist/${encodeURIComponent(id)}`;
    const html = await fetchHTML(url);
    const $ = cheerio.load(html);
    const title = $('h1').first().text().trim() || $('meta[property="og:title"]').attr('content') || '';
    const image = $('meta[property="og:image"]').attr('content') || '';
    const tracks = [];
    $('.song, .listSong, .song-list li').each((i, el) => {
      const t = $(el).find('.song-title').text().trim() || $(el).find('.u-color-txt_primary').text().trim();
      const link = $(el).find('a[href*="/song/"]').attr('href') || '';
      const id2 = link.split('/song/')[1] || '';
      if (t) tracks.push({ id: id2, title: t });
    });
    return res.json({ id, title, image, tracks });
  } catch (e) {
    console.error('Playlist error', e.message);
    return res.status(500).json({ error: 'Playlist fetch failed', detail: e.message });
  }
});

app.post('/recommend', async (req, res) => {
  try {
    const r = await axios.get('https://www.jiosaavn.com/search/trending');
    const $ = cheerio.load(r.data);
    const results = [];
    $('.song, .listSong, .song-list li').each((i, el) => {
      const title = $(el).find('.song-title').text().trim() || $(el).find('.u-color-txt_primary').text().trim();
      const link = $(el).find('a[href*="/song/"]').attr('href') || '';
      const id = link.split('/song/')[1] || '';
      if (title) results.push({ id, title, _source: 'jiosaavn' });
    });
    return res.json({ count: results.length, results: results.slice(0,30) });
  } catch (e) {
    console.error('Recommend error', e.message);
    return res.status(500).json({ error: 'Recommend failed', detail: e.message });
  }
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => console.log('JioSaavn backend running on port', PORT));
