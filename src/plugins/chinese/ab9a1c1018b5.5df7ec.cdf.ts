import { load as parseHTML } from 'cheerio';
import { fetchApi, fetchText } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';

class ab9a1c1018b5Plugin implements Plugin.PluginBase {
  private fetchOptions = {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
      'Accept-Language':
        'ru,en-US;q=0.9,en;q=0.8,zh-TW;q=0.7,zh-CN;q=0.6,zh;q=0.5',
      'Referer': 'https://1da5dab587768.5df7ec.cfd/', // Referer
      'DNT': '1', // Do Not Track
      'Upgrade-Insecure-Requests': '1', // Upgrade-Insecure-Requests
    },
  };

  id = 'bikuge';
  name = '笔趣阁 (ab9a1c1018b5.5df7ec.cfd)';
  icon = 'src/cn/mde2a0a8/icon.png';
  site = 'https://1da5dab587768.5df7ec.cfd/';
  version = '20.2.4';

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];
    const body = await fetchText(this.site, this.fetchOptions);
    if (body === '') throw Error('无法获取小说列表，请检查网络');

    const $ = parseHTML(body);

    const novels: Plugin.NovelItem[] = [];

    /** -----------------------
     * 1) Handle "div.hot > div.item"
     * ------------------------ */
    $('div.wrap > div.hot > div.item').each((_, el) => {
      const novelPath = $(el).find('div.p10 div.image a').attr('href');
      const novelCover = $(el).find('div.p10 div.image a img').attr('src');
      const novelName = $(el).find('div.p10 div.image a img').attr('alt');

      if (!novelPath) return;

      novels.push({
        name: novelName?.trim() || 'Untitled',
        cover: novelCover,
        path: novelPath.replace(this.site, ''),
      });
    });

    /** -----------------------
     * 2) Handle "div.block > ul.lis > li"
     * ------------------------ */
    $('div.wrap > div.block ul.lis li').each((_, el) => {
      const novelPath = $(el).find('span.s2 a').attr('href');
      const novelName = $(el).find('span.s2 a').text().trim();

      if (!novelPath) return;

      novels.push({
        name: novelName,
        cover: undefined, // no cover available in this section
        path: novelPath.replace(this.site, ''),
      });
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const novelUrl = makeAbsolute(novelPath, this.site);
    if (!novelUrl) throw new Error('Invalid novel URL');

    const result = await fetchApi(novelUrl);
    if (!result.ok) throw new Error('Failed to fetch novel');

    const $ = parseHTML(await result.text());
    const $infoSection = $('div.books');

    // --- Cover ---
    const novelCover =
      makeAbsolute($infoSection.find('div.cover img').attr('src'), this.site) ||
      defaultCover;

    // --- Title ---
    const novelName = $infoSection
      .find('div.book_box dl dt.name')
      .text()
      .trim();

    // --- Author ---
    const $ddSpans = $infoSection.find('div.book_box dl dd.dd_box span');
    const authorText = $ddSpans.first().text().trim();
    const author = authorText.replace(/^.*?作者：/, '').trim() || undefined;

    // --- Genre ---
    const genreText = $ddSpans
      .eq(1)
      .text()
      .trim()
      .replace(/^.*?分类：/, '');
    let genre: string | undefined = undefined;
    switch (genreText) {
      case '玄幻':
        genre = 'Fantasy';
        break;
      case '武侠':
        genre = 'Martial Arts';
        break;
      case '都市':
        genre = 'Urban';
        break;
      case '历史':
        genre = 'Historical';
        break;
      case '网游':
        genre = 'Games';
        break;
      case '科幻':
        genre = 'Sci-fi';
        break;
      default:
        genre = undefined;
    }

    // --- Status ---
    const statusText = $ddSpans.eq(1).text().trim(); // same span as genre
    let detail: 'Ongoing' | 'Completed' | 'Unknown' = 'Unknown';
    if (statusText.includes('已经完本')) {
      detail = 'Completed';
    } else if (statusText.includes('连载')) {
      detail = 'Ongoing';
    } else {
      detail = 'Unknown';
    }

    // --- Summary ---
    const $summaryDD = $infoSection.find('div.book_about dl dd').clone();
    $summaryDD.find('span.allshow').remove(); // drop "show more" span
    const summary = $summaryDD.text().trim();
    const translated_summary = await translate(summary, 'ru');

    // --- Chapter list link ---
    const chapterListPath = $infoSection.find('div.book_more a').attr('href');

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: novelName || 'Untitled',
      cover: novelCover,
      summary: translated_summary || undefined,
      author,
      genres: genre,
      status:
        detail === 'Ongoing'
          ? NovelStatus.Ongoing
          : detail === 'Completed'
            ? NovelStatus.Completed
            : NovelStatus.Unknown,
      chapters: [],
    };

    if (chapterListPath) {
      novel.chapters = await this.parseChapterList(chapterListPath);
    }

    return novel;
  }

  async parseChapterList(
    chapterListPath: string,
  ): Promise<Plugin.ChapterItem[]> {
    const chapterListUrl = makeAbsolute(chapterListPath, this.site);
    if (!chapterListUrl) return [];

    const result = await fetchApi(chapterListUrl);
    if (!result.ok) return [];

    const $ = parseHTML(await result.text());
    const chapters: Plugin.ChapterItem[] = [];

    $('div.book_last dl dd').each((index, el) => {
      const $dd = $(el);
      const $a = $dd.find('a');

      // skip dummy entries with href="#footer"
      if ($a.attr('href') === '#footer') return;

      const chapterUrl = $a.attr('href')?.trim();
      const chapterName = $a.text().trim();

      if (chapterUrl && chapterName) {
        chapters.push({
          name: chapterName,
          path: chapterUrl,
          chapterNumber: chapters.length + 1,
        });
      }
    });

    return chapters;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    // Start from absolute chapter URL (handles relative or absolute input)
    let currentUrl = new URL(chapterPath, this.site).toString();

    // Base path of the chapter used to decide if next link is "same chapter part"
    // e.g. "/book/61808/1183"
    const initialBasePath = new URL(currentUrl).pathname.replace(
      /_\d+\.html$|\.html$/i,
      '',
    );

    const parts: string[] = [];
    let safetyCounter = 0;
    const MAX_PAGES = 50; // safety to prevent infinite loops

    while (currentUrl && safetyCounter < MAX_PAGES) {
      safetyCounter++;

      const body = await fetchText(currentUrl, this.fetchOptions);
      const $ = parseHTML(body);

      // --- Extract content ---
      const $content = $('#chaptercontent').clone();
      // remove direct <p> children if they are wrappers/ads (preserve other tags)
      $content.children('p').remove();

      // get cleaned HTML and strip known junk strings
      let chapterHtml = $content.html()?.trim() ?? '';
      if (chapterHtml) {
        chapterHtml = chapterHtml
          .replace(/69书吧/g, '')
          .replace(/请收藏：https?:\/\/m\.57ae58c447\.cfd/gi, '')
          .replace(/内容未完，下一页继续阅读好紧/gi, '');
        parts.push(chapterHtml);
      }

      // --- Find "next page" link (could be relative or absolute) ---
      const nextHrefRaw = $('#pb_next').attr('href');
      if (!nextHrefRaw) break;

      // ignore anchors / javascript pseudo-links
      if (nextHrefRaw.startsWith('#') || /^javascript:/i.test(nextHrefRaw))
        break;

      // make absolute URL for the next page
      const nextUrl = new URL(nextHrefRaw, currentUrl).toString();

      // Avoid infinite loop if it points to the same URL
      if (nextUrl === currentUrl) break;

      // Compute base path for next page and compare to initial base.
      // If they differ, the next link points to a new chapter (stop).
      const nextBasePath = new URL(nextUrl).pathname.replace(
        /_\d+\.html$|\.html$/i,
        '',
      );
      if (nextBasePath !== initialBasePath) break;

      // Otherwise continue with next part of the same chapter
      currentUrl = nextUrl;
    }

    if (safetyCounter >= MAX_PAGES) {
      console.warn(
        'parseChapter: reached max pages while following chapter parts',
      );
    }

    const fullHtml = parts.join('<br>');

    let chapterText = await translateHtmlByLinePlain(fullHtml, 'ru');

    return chapterText;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    // This site only returns first page, skip others
    if (pageNo > 1) return [];

    const url = `${this.site}user/search.html?q=${encodeURIComponent(searchTerm)}&so=undefined`;

    const response = await fetch(url, {
      headers: {
        'accept': 'application/json',
        'referer': `${this.site}s?q=${encodeURIComponent(searchTerm)}`,
        'sec-ch-ua':
          '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'user-agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        'x-requested-with': 'XMLHttpRequest',
        'dnt': '1',
      },
    });

    if (!response.ok) throw new Error('Failed to fetch search results');

    const text = await response.text();

    // Handle case when response is "1" (no results)
    if (text.trim() === '1') throw new Error('No results');

    console.log('Search response text:', text);

    let data: any;
    try {
      data = JSON.parse(text);
      if (typeof data === 'string') {
        data = JSON.parse(data);
      }
    } catch (err) {
      console.error('Failed to parse search results:', err);
      return [];
    }

    const novels: Plugin.NovelItem[] = data.map((item: any) => ({
      path: item.url_list, // relative URL
      cover: item.url_img, // full cover URL
      name: item.articlename, // novel name
      author: item.author, // author
      summary: item.intro, // short intro
    }));

    return novels;
  }
}

export default new ab9a1c1018b5Plugin();

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
