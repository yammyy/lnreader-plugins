import { load as loadCheerio } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { Filters } from '@libs/filterInputs';
import { NovelStatus } from '@libs/novelStatus';

class Novel18Syosetu implements Plugin.PluginBase {
  id = 'novel18.syosetu';
  name = 'Novel18 Syosetu';
  icon = 'src/jp/syosetu/icon.png'; // reuse or change if needed
  site = 'https://novel18.syosetu.com/';
  novelPrefix = 'https://novel18.syosetu.com';
  version = '1.0.0';
  headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    const url = `https://mnlt.syosetu.com/rank/top/?p=${pageNo}`;
    const html = await (await fetchApi(url, { headers: this.headers })).text();
    const $ = loadCheerio(html);

    const novels: Plugin.NovelItem[] = [];
    $('.rank_h').each((_, e) => {
      const a = $(e).find('a').first();
      const href = a.attr('href');
      const name = a.text().trim();
      if (href && name) {
        novels.push({
          name,
          path: href.replace('/top/', ''), // e.g. /n2096el/ -> n2096el/
          cover: defaultCover,
        });
      }
    });
    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = this.novelPrefix + novelPath;
    const html = await (await fetchApi(url, { headers: this.headers })).text();
    const $ = loadCheerio(html);

    let status = 'Unknown';
    if ($('.novel_status').text().includes('連載中'))
      status = NovelStatus.Ongoing;
    if ($('.novel_status').text().includes('完結済'))
      status = NovelStatus.Completed;

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: $('.novel_title').text().trim(),
      author:
        $('.novel_writername a').text().trim() ||
        $('.novel_writername').text().replace('作者：', '').trim(),
      status,
      cover: defaultCover,
      summary: $('#novel_ex').text().trim() || undefined,
      genres: $('meta[name="keywords"]').attr('content') || '',
      chapters: [],
    };

    const chapters: Plugin.ChapterItem[] = [];
    $('.chapter_title').each((i, e) => {
      const part = $(e).text().trim();
      if (part) {
        chapters.push({
          name: `Part ${i + 1}: ${part}`,
          path: novelPath,
        });
      }
    });

    $('.index_box .novel_sublist2').each((_, e) => {
      const a = $(e).find('a');
      const href = a.attr('href');
      const title = a.text().trim();
      const date = $(e)
        .find('.long_update')
        .text()
        .trim()
        .split(' ')[0]
        .replace(/\//g, '-');
      if (href && title) {
        chapters.push({
          name: title,
          path: href.replace(this.novelPrefix, ''),
          releaseTime: date || undefined,
        });
      }
    });

    novel.chapters = chapters;
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = this.novelPrefix + chapterPath;
    const html = await (await fetchApi(url, { headers: this.headers })).text();
    const $ = loadCheerio(html);

    const title = $('.novel_subtitle').text().trim();
    const content = $('#novel_honbun').html() || '';

    const rawHtml = `<h1>${title}</h1><br>${content}`;
    // Remove translation if not needed, or keep your translate function
    // For now return raw (site is Japanese, but plugin originally translated)
    return rawHtml.trim();
  }

  async searchNovels(
    searchTerm: string,
    pageNo?: number,
  ): Promise<Plugin.NovelItem[]> {
    const url = `https://nl.syosetu.com/syuppan/list/?word=${encodeURIComponent(searchTerm)}&p=${pageNo || 1}`;
    const html = await (await fetchApi(url, { headers: this.headers })).text();
    const $ = loadCheerio(html);

    const novels: Plugin.NovelItem[] = [];
    $('.search_result_title a').each((_, e) => {
      const a = $(e);
      const href = a.attr('href');
      const name = a.text().trim();
      if (href && name) {
        novels.push({
          name,
          path: href.replace('/syuppan/view/', '').replace('/', ''),
          cover: defaultCover,
        });
      }
    });
    return novels;
  }

  resolveUrl(path: string): string {
    return this.novelPrefix + path;
  }

  filters = {} satisfies Filters; // no filters for this site yet
}

export default new Novel18Syosetu();

//DON'T CHANGE IT HERE!

//This is the copy of @libs/isAbsolutUrl/makeAbsolute.
const makeAbsolute = (
  relativeUrl: string | undefined,
  baseUrl: string,
): string | undefined => {
  if (!relativeUrl) return undefined;
  try {
    if (relativeUrl.startsWith('//')) {
      return new URL(baseUrl).protocol + relativeUrl;
    }
    if (
      relativeUrl.startsWith('http://') ||
      relativeUrl.startsWith('https://')
    ) {
      return relativeUrl;
    }
    // Remove trailing slash from baseUrl if present
    const normalizedBase = baseUrl.endsWith('/')
      ? baseUrl.slice(0, -1)
      : baseUrl;

    // Remove leading slash from relativeUrl if present
    const normalizedRelative = relativeUrl.startsWith('/')
      ? relativeUrl.slice(1)
      : relativeUrl;

    //    return `${normalizedBase}/${normalizedRelative}`;
    return new URL(normalizedRelative, normalizedBase).href;
  } catch {
    return undefined;
  }
};

//This is the copy of @libs/googleTranslate.ts
// Разбиваем HTML на логические абзацы
function splitParagraphs(html: string): string[] {
  const text = html
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\u3000/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return text
    .split(/\n+/)
    .map(p => p.trim())
    .filter(Boolean);
}

// Делим длинный абзац на части по знакам препинания или словам
function splitLongParagraph(p: string, max = 1000): string[] {
  if (p.length <= max) return [p];

  const parts = p
    .split(/([。.!?！？])/g)
    .reduce((acc: string[], cur) => {
      if (!acc.length || (acc[acc.length - 1] + cur).length > max)
        acc.push(cur);
      else acc[acc.length - 1] += cur;
      return acc;
    }, [])
    .flatMap(chunk => {
      if (chunk.length <= max) return [chunk];
      const words = chunk.split(/\s+/);
      const res: string[] = [];
      let cur = '';
      for (const w of words) {
        if ((cur + ' ' + w).trim().length > max) {
          if (cur) res.push(cur.trim());
          cur = w;
        } else cur = (cur + ' ' + w).trim();
      }
      if (cur) res.push(cur.trim());
      return res;
    });

  return parts;
}

// Создаём готовые к переводу куски
export function makeChunksFromHTML(html: string, max = 1000): string[] {
  return splitParagraphs(html).flatMap(p => splitLongParagraph(p, max));
}

// Перевод одного куска через Google Translate
async function translateChunk(chunk: string, lang: string): Promise<string> {
  const res = await fetch(
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=${lang}&dt=t&q=${encodeURIComponent(chunk)}`,
  );
  if (!res.ok) throw new Error(`Translate failed ${res.status} ${chunk}`);
  const data = await res.json();
  return data[0].map((d: any) => d[0]).join('');
}

// Основная функция перевода
export async function translate(text: string, lang: string): Promise<string> {
  if (text.length < 2) return text;
  const chunks = makeChunksFromHTML(text, 1000);
  const translations: string[] = [];
  for (const c of chunks) {
    translations.push(await translateChunk(c, lang));
    await new Promise(r => setTimeout(r, 500));
  }
  return translations.map(p => `<p>${p}</p>`).join('\n');
}

async function translateHtmlByLinePlain(
  html: string,
  targetLang: string,
  sourceLang: string = 'auto', // 👈 по умолчанию auto
) {
  // 1️⃣ Normalize tags: remove all attributes
  html = html.replace(/<(\w+)[^>]*>/g, '<$1>');

  // 2️⃣ Split into "lines" based on closing tags or <br>
  // Use closing </p>, </h1>-</h4>, </li> as line breaks; <br> as line break
  const lineBreakTags = [
    '</p>',
    '</h1>',
    '</h2>',
    '</h3>',
    '</h4>',
    '</li>',
    '<br>',
  ];

  let lines: { tag: string; text: string; parentTag?: string }[] = [];

  // Split by line break tags, keeping the tag
  const regex = new RegExp(`(${lineBreakTags.join('|')})`, 'gi');
  const parts = html.split(regex).filter(Boolean);

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (lineBreakTags.includes(part.toLowerCase())) {
      // just a tag, skip or mark break
      continue;
    }
    const next =
      parts[i + 1] && lineBreakTags.includes(parts[i + 1].toLowerCase())
        ? parts[i + 1].toLowerCase()
        : '';

    const text = part.replace(/<[^>]+>/g, '').trim();
    if (!text) continue;

    if (next === '</li>') {
      lines.push({ tag: 'LI', text, parentTag: 'UL' });
    } else if (next.startsWith('</h')) {
      lines.push({ tag: next.replace(/[<>]/g, '').toUpperCase(), text });
      lines.push({ tag: 'BR', text: '' });
    } else if (next === '</p>') {
      lines.push({ tag: 'P', text });
    } else if (next === '<br>') {
      lines.push({ tag: 'P', text });
    } else {
      lines.push({ tag: 'P', text });
    }
  }

  const SEPARATOR = ' 😀 '; // Unique separator unlikely to appear in text

  // 3️⃣ Extract plain text for translation
  const plainText = lines
    .map(n => (n.tag === 'BR' ? '' : n.text))
    .join(SEPARATOR);

  // 4️⃣ Translate plain text (используем sourceLang)
  let translatedText = await translateAutoHotkeyStyle(
    plainText,
    targetLang,
    sourceLang,
  ); // Remove the outer brackets and the second array
  translatedText = translatedText
    .replace(/^\[\[\"/, '') // remove opening [["
    .replace(/\"\],\s*\[\".*\"\]\]$/, ''); // remove ",["ln"]]

  const translatedLines = translatedText.split(SEPARATOR);

  // 5️⃣ Rebuild HTML with tags
  let htmlResult = '';

  for (let i = 0; i < lines.length; i++) {
    const node = lines[i];
    const line = translatedLines[i] || '';

    if (/^Глава\s+\d+/i.test(line)) {
      htmlResult += `<h1>${line}</h1>`;
    } else if (node.tag === 'BR') {
      htmlResult += '<br>';
    } else if (node.tag === 'LI') {
      htmlResult += `<ul><li>${line}</li></ul>`;
    } else if (node.tag.startsWith('H')) {
      htmlResult += `<${node.tag}>${line}</${node.tag}>`;
    } else {
      htmlResult += `<p>${line}</p>`;
    }
  }

  return htmlResult;
}

export async function translateAutoHotkeyStyle(
  text: string,
  lang: string,
  sourceLang: string = 'auto', // 👈 тоже по умолчанию auto
): Promise<string> {
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

  // === 1️⃣ POST to translateHtml (same as AHK, but response ignored) ===
  const postPayload = JSON.stringify([[[text], sourceLang, lang], 'te_lib']);

  let htext = '';
  // === 2️⃣ Fetch with error handling ===
  try {
    const response = await fetch(
      'https://translate-pa.googleapis.com/v1/translateHtml',
      {
        method: 'POST',
        headers: {
          'User-Agent': userAgent,
          'X-Goog-API-Key': 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520',
          'Content-Type': 'application/json+protobuf',
        },
        body: postPayload,
      },
    );

    // Check if server actually responded with success
    if (!response.ok) {
      htext = `HTTP error ${response.status}: ${response.statusText}`;
      const text = await response.text(); // optional, to see the error body
      htext += '\nError body:' + text;
      return htext;
    }

    // If all good
    htext = await response.text();
  } catch (err) {
    // Network errors, DNS failures, etc.
    htext = 'Fetch failed:' + err;
  }

  return htext;
}
