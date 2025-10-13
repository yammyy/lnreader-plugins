import { load as parseHTML } from 'cheerio';
import { fetchApi, fetchFile } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class ixdzs8Plugin implements Plugin.PluginBase {
  id = 'ixdzs8';
  name = '爱下电子书';
  site = 'https://ixdzs8.com/';
  version = '7.0.3';
  icon = 'src/cn/ixdzs8/favicon.png';

  imageRequestInit = {
    headers: {
      Referer: this.site,
    },
  };

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    let url = `${this.site}hot/?page=${pageNo}`;
    const result = await fetchApi(url);
    if (!result.ok) return [];

    const $ = parseHTML(await result.text());
    const novels: Plugin.NovelItem[] = [];
    const processedPaths = new Set<string>();

    $('ul.u-list > li.burl').each((_i, el) => {
      const $el = $(el);
      let novelPath: string | undefined;
      let novelName: string | undefined;
      let novelCover: string | undefined;

      const $link = $el.find('.l-info h3 a');
      novelPath = $link.attr('href')?.trim();
      novelName = ($link.attr('title') || $link.text() || '').trim();
      novelCover = $el.find('.l-img img').attr('src')?.trim();

      if (novelPath && novelName) {
        novels.push({
          name: novelName,
          path: novelPath,
          cover: makeAbsolute(novelCover, this.site) || defaultCover,
        });
        processedPaths.add(novelPath);
      }
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const novelUrl = makeAbsolute(novelPath, this.site);
    if (!novelUrl) throw new Error('Invalid novel URL');

    const result = await fetchApi(novelUrl);
    if (!result.ok) throw new Error('Failed to fetch novel');

    const $ = parseHTML(await result.text());
    const $novel = $('div.novel');
    const $intro = $('p#intro.pintro');
    // Remove any child elements you don't want, e.g., the "read more" icon
    $intro.find('span.icon').remove();
    // Get text and normalize whitespace
    const summary = $intro
      .html() // get inner HTML
      ?.replace(/<br\s*\/?>/gi, '\n') // convert <br> to line breaks
      .replace(/<[^>]+>/g, '') // remove remaining tags like <font>
      .replace(/\u3000/g, ' ') // replace full-width spaces
      .replace(/&nbsp;/g, ' ') // replace spaces
      .split('\n') // split into lines
      .map(line => line.trim()) // trim each line
      .filter(line => line.length > 0) // remove empty lines
      .join(' '); // join into one paragraph
    let summary_translate: string | undefined;
    if (summary !== undefined) {
      summary_translate = await translate(summary, 'ru');
    } else {
      summary_translate = undefined;
    }

    let genre = $novel.find('.n-text p a.nsort').text().trim();
    switch (genre) {
      case '玄幻奇幻':
        genre = 'Fantasy';
        break;
      case '武侠小说':
        genre = 'Martial Arts';
        break;
      case '修真仙侠':
        genre = 'Cultivation';
        break;
      case '都市青春':
        genre = 'Urban';
        break;
      case '军事历史':
        genre = 'Historical';
        break;
      case '网游竞技':
        genre = 'Games';
        break;
      case '科幻灵异':
        genre = 'Sci-fi';
        break;
      case '言情穿越':
        genre = 'Romance';
        break;
      case '耽美同人':
        genre = 'Yaoi';
        break;
      case '其他小说':
        genre = 'Other';
        break;
    }
    const $tagsDiv = $('div.panel div.tags');
    // find all <a> inside <em> and get their text
    // Select <p> that contains <a.nsort>
    let novelTags = $tagsDiv
      .find('em a')
      .map((_i, el) => $(el).text().trim())
      .get()
      .filter(tag => tag.length > 0) // remove empty strings
      .join(', ');
    novelTags = genre + ', ' + novelTags;

    const statOngoing = $novel.find('.n-text p span.lz').text().trim();
    const statEnd = $novel.find('.n-text p span.end').text().trim();
    let detail: 'Ongoing' | 'Completed' | 'Unknown' = 'Unknown';
    if (statEnd.length > 0) {
      detail = 'Completed';
    } else if (statOngoing.length > 0) {
      detail = 'Ongoing';
    } else {
      detail = 'Unknown';
    }

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: $novel.find('.n-text h1').text().trim() || 'Untitled',
      cover:
        makeAbsolute($novel.find('.n-img img').attr('src'), this.site) ||
        defaultCover,
      summary: summary_translate,
      author: $novel.find('.n-text p a.bauthor').text().trim() || undefined,
      genres: novelTags,
      status:
        detail === 'Ongoing'
          ? NovelStatus.Ongoing
          : detail === 'Completed'
            ? NovelStatus.Completed
            : NovelStatus.Unknown,
      chapters: [],
    };

    const chapterListPath = $('#bid').attr('value'); // get bid from page
    if (chapterListPath) {
      novel.chapters = await this.parseChapterList(chapterListPath);
    }

    return novel;
  }

  async parseChapterList(bid: string | number): Promise<Plugin.ChapterItem[]> {
    // Convert bid to string just in case
    const bookId = String(bid);

    // POST request to fetch chapter list JSON
    let url = `${this.site}novel/clist/`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `bid=${bookId}`,
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch chapters for bid=${bookId}`);
    }

    const json = await res.json();

    if (json.rs !== 200 || !Array.isArray(json.data)) {
      throw new Error('Invalid response format from chapter list');
    }

    // Build chapters array
    const chapters: Plugin.ChapterItem[] = json.data.map((ch: any) => {
      return {
        name: ch.title,
        path: ch.ctype === '0' ? `read/${bookId}/p${ch.ordernum}.html` : '', // only normal chapters get link
        releaseTime: undefined, // optional, not provided here
      };
    });

    return chapters;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const chapterUrl = makeAbsolute(chapterPath, this.site);
    if (!chapterUrl) throw new Error('Invalid chapter URL');

    // --- 1st request ---
    let result = await fetchApi(chapterUrl);
    if (!result.ok) throw new Error(`Failed to fetch chapter at ${chapterUrl}`);

    let html = await result.text();

    // --- Check if we got challenge page ---
    if (html.includes('正在進行安全驗證') || html.includes('challenge')) {
      const tokenMatch = html.match(/let token\s*=\s*"([^"]+)"/);
      if (tokenMatch) {
        const challengeUrl =
          chapterUrl + '?challenge=' + encodeURIComponent(tokenMatch[1]);

        result = await fetchApi(challengeUrl);
        if (!result.ok)
          throw new Error(`Failed after challenge redirect: ${challengeUrl}`);
        html = await result.text();
      }
    }

    // --- Parse content ---
    const $ = parseHTML(html);
    const $title = $('article h3');
    let title = $title.text().trim();
    const $content = $('article section');

    if (!$content.length) {
      return `Error: Could not find chapter content at ${chapterUrl}`;
    }

    // Remove ads & junk
    $content
      .find(
        'script, style, ins, iframe, [class*="abg"], [class*="ads"], [id*="ads"], [class*="google"], [id*="google"], [class*="recommend"], div[align="center"], p:contains("推薦本書"), a[href*="javascript:"]',
      )
      .remove();

    // Drop empty <p>
    $content.find('p').each((_i, el) => {
      const $p = $(el);
      if (!$p.text().trim()) $p.remove();
    });

    // Remove HTML comments
    $content
      .contents()
      .filter(function () {
        return this.type === 'comment';
      })
      .remove();

    let rawHtml = $content.html() || '';
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
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const searchUrl = `${this.site}bsearch?q=${encodeURIComponent(searchTerm)}`;
    let body = '';

    try {
      const result = await fetchApi(searchUrl);
      if (!result.ok) {
        throw new Error(
          `Failed to fetch search results: HTTP ${result.status}`,
        );
      }
      body = await result.text();
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to fetch search results: ${error.message}`);
      }
      throw error;
    }

    const $ = parseHTML(body);
    const novels: Plugin.NovelItem[] = [];

    $('ul.u-list li.burl').each((_i, el) => {
      const $el = $(el);

      const novelPath = $el.attr('data-url')?.trim();
      const novelName = $el.find('h3.bname a').text().trim();
      const novelCover = $el.find('.l-img img').attr('src')?.trim();

      if (novelPath && novelName) {
        novels.push({
          name: novelName,
          path: novelPath,
          cover: makeAbsolute(novelCover, this.site) || defaultCover,
        });
      }
    });

    return novels;
  }
}

export default new ixdzs8Plugin();

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
