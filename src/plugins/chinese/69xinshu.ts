import { load as parseHTML } from 'cheerio';
import { fetchText, fetchApi } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class XinShu69 implements Plugin.PluginBase {
  id = '69xinshu';
  name = '69书吧';
  icon = 'src/cn/69xinshu/icon.png';
  site = 'https://www.69yue.top/';
  version = '9.1.2';

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    const apiUrl = `${this.site}api/list/0/0/1/${pageNo}.json`;
    const result = await fetchApi(apiUrl);
    if (!result.ok) return [];

    const json = await result.json();

    if (json.code !== 200 || !Array.isArray(json.data)) {
      throw new Error('Invalid API response');
    }

    const novels: Plugin.NovelItem[] = json.data.map((item: any) => ({
      name: item.title.trim(),
      path: makeAbsolute(item.infourl.trim(), this.site) || '',
      cover: item.coverUrl?.trim()
        ? item.coverUrl.startsWith('/')
          ? this.site + item.coverUrl.replace(/^\//, '')
          : item.coverUrl
        : defaultCover,
      author: item.author?.trim() || '',
      description: item.description?.trim() || '',
      status: item.status?.trim() || '',
      category: item.categoryName?.trim() || '',
      lastUpdate: item.lastUpdated?.trim() || '',
    }));

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const novelUrl = makeAbsolute(novelPath, this.site);
    if (!novelUrl) throw new Error('Invalid novel URL');

    const result = await fetchApi(novelUrl);
    if (!result.ok) throw new Error('Failed to fetch novel');

    const $ = parseHTML(await result.text());

    // === Novel cover ===
    const novelCover =
      makeAbsolute($('img.object-cover').attr('src')?.trim(), this.site) ||
      defaultCover;

    // === Novel name ===
    const novelName = $('main div div div div div div h1')
      .first()
      .text()
      .trim();
    /*
    // === Genre ===
    let genre = $('main div div div div div div div p.text-base a')
      .first()
      .text()
      .trim();
    genre = genre || '';
    switch (genre) {
      case '玄幻魔法':
        genre = 'Fantasy';
        break;
      case '修真武侠':
        genre = 'Martial Arts';
        break;
      case '言情小说':
        genre = 'Romance';
        break;
      case '历史军事':
        genre = 'Historical';
        break;
      case '游戏竞技':
        genre = 'Games';
        break;
      case '科幻空间':
        genre = 'Sci-Fi';
        break;
      case '悬疑惊悚':
        genre = 'Mystery';
        break;
      case '同人小说':
        genre = 'Fan Fiction';
        break;
      case '都市小说':
        genre = 'Urban';
        break;
      case '官场职场':
        genre = 'Work Life';
        break;
      case '穿越时空':
        genre = 'Time Travel';
        break;
      case '青春校园':
        genre = 'School Life';
        break;
      case '其他':
        genre = 'Other';
        break;
    }

    // === Status ===
    let statusText = $('main div div div div div div div p.text-base')
      .filter((_i, el) => {
        const txt = $(el).text();
        return txt.includes('连载中') || txt.includes('完本');
      })
      .text()
      .trim();

    let status = '';
    if (statusText.includes('连载中')) status = NovelStatus.Ongoing;
    else if (statusText.includes('完本')) status = NovelStatus.Completed;
    else status = NovelStatus.Unknown;

    // === Get chapter list link ===
    const chapterListPath = $('div#load-more-container a').attr('href')?.trim();
    const chapterListUrl = chapterListPath
      ? makeAbsolute(chapterListPath, this.site)
      : undefined;

    // === Fetch chapters ===
    const chapters: Plugin.ChapterItem[] = [];
    if (chapterListUrl) {
      const chapterRes = await fetchApi(chapterListUrl);
      if (chapterRes.ok) {
        const $$ = parseHTML(await chapterRes.text());

        $$('#chapter-list-grid a').each((_i, el) => {
          const $el = $$(el);
          const chapterPath = $el.attr('href')?.trim();
          const chapterName = $el.text().trim();

          if (chapterPath && chapterName) {
            chapters.push({
              name: chapterName,
              path: chapterPath,
              releaseTime: undefined,
            });
          }
        });
      }
    }
*/
    // === Summary (optional: none described) ===
    /*    let summary: string | undefined;
    let summary_translate: string | undefined;
    if (summary) {
      summary_translate = await translate(summary, 'ru');
      summary_translate = summary_translate.replace(/<[^>]+>/g, '');
    }*/

    // === Assemble novel object ===
    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: novelName,
      cover: novelCover,
      summary: '',
      author: '', //undefined,
      genres: '', //genre,
      status: '',
      chapters: [],
    };

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const chapterUrl = makeAbsolute(chapterPath, this.site);
    if (!chapterUrl) throw new Error('Invalid chapter URL');

    const result = await fetchApi(chapterUrl);
    if (!result.ok) throw new Error('Failed to fetch chapter');

    const $ = parseHTML(await result.text());

    // === Chapter title ===
    const title = $('main > header > h2').first().text().trim();

    // === Target the inner article (the one containing <p>) ===
    const $article = $('main > article > article').first();
    if (!$article.length) return 'Error: Could not find chapter content';

    // Remove junk <div> inside the article
    $article.find('div').remove();

    let rawHtml = $article.html() || '';
    if (!rawHtml) return 'Error: Chapter content was empty';
    rawHtml = '<h1>' + title + '</h1>' + '🐼<br>' + rawHtml;
    let chapterText = '';

    if (rawHtml.trim()) {
      chapterText = await translateHtmlByLinePlain(rawHtml, 'ru');
    } else {
      chapterText = ''; // or keep as is, no translation
    }

    return chapterText.trim();
  }

  async searchNovels(
    searchTerm: string,
    _pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const apiUrl = `${this.site}api/search`;

    const result = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Referer: `${this.site}search.html?q=${encodeURIComponent(searchTerm)}`,
      },
      body: `q=${encodeURIComponent(searchTerm)}`,
    });

    if (!result.ok) return [];

    const data = await result.json();
    if (data.code !== 200 || !Array.isArray(data.results)) return [];

    const novels: Plugin.NovelItem[] = data.results.map((item: any) => ({
      name: item.title?.trim() || 'Unknown',
      path: makeAbsolute(item.infourl.trim(), this.site) || '',
      cover: defaultCover,
    }));

    return novels;
  }
}

export default new XinShu69();

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
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=${lang}&dt=t&q=${encodeURIComponent(chunk)}`,
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

async function translateHtmlByLinePlain(html: string, targetLang: string) {
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

  for (let i = 0; i < parts.length; i += 2) {
    const text = (parts[i] || '').replace(/<[^>]+>/g, '').trim();
    const tag = (parts[i + 1] || '').toLowerCase();

    if (!text && !tag) continue;

    if (tag === '</li>') {
      if (text) lines.push({ tag: 'LI', text, parentTag: 'UL' });
    } else if (tag.startsWith('</h')) {
      if (text)
        lines.push({ tag: tag.replace(/[<>]/g, '').toUpperCase(), text }); // H1-H4
      lines.push({ tag: 'BR', text: '' });
    } else if (tag === '</p>') {
      if (text) lines.push({ tag: 'P', text });
    } else if (tag === '<br>') {
      if (text) lines.push({ tag: 'P', text });
    } else if (text) {
      lines.push({ tag: 'P', text });
    }
  }

  const SEPARATOR = ' 😀 '; // Unique separator unlikely to appear in text

  // 3️⃣ Extract plain text for translation
  const plainText = lines
    .map(n => (n.tag === 'BR' ? '' : n.text))
    .join(SEPARATOR);

  // 4️⃣ Translate plain text
  let translatedText = await translateAutoHotkeyStyle(plainText, targetLang);
  // Remove the outer brackets and the second array
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
): Promise<string> {
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

  // === 1️⃣ POST to translateHtml (same as AHK, but response ignored) ===
  const postPayload = JSON.stringify([[[text], 'auto', lang], 'wt_lib']);

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
