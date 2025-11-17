import { load as parseHTML } from 'cheerio';
import { fetchApi, fetchFile } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class TuyePlugin implements Plugin.PluginBase {
  id = 'tuye';
  name = '途阅小说';
  site = 'https://mfirst.haiyuangabiou.com/';
  version = '5.0.0';
  icon = 'src/cn/tuye/favicon.png';

  imageRequestInit = {
    headers: {
      Referer: this.site,
    },
  };

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    // Site shows everything on one page
    if (pageNo > 1) return [];

    const url = `${this.site}top/`;
    const result = await fetchApi(url);
    if (!result.ok) return [];

    const $ = parseHTML(await result.text());
    const novels: Plugin.NovelItem[] = [];
    const processedPaths = new Set<string>();

    // Each "div.unit" represents a block of novels
    $('div.unit').each((_i, unitEl) => {
      const $unit = $(unitEl);

      // Inside unit → div.frame.clearfix → ul → li
      $unit.find('div.frame.clearfix ul li').each((_j, liEl) => {
        const $li = $(liEl);

        /* ----------------------- COVER ----------------------- */
        // Inside div.lf → img[src]
        const cover =
          $li.find('div.lf img').attr('src')?.trim() || defaultCover;

        /* ------------------- PATH + TITLE -------------------- */
        // a[href] inside h1.hidden (inside div.rt2)
        const $link = $li.find('div.rt2 h1.hidden a');
        const novelPath = $link.attr('href')?.trim();
        const novelName = $link.text().trim();

        // Validate and avoid duplicates
        if (novelPath && novelName && !processedPaths.has(novelPath)) {
          novels.push({
            name: novelName,
            path: novelPath,
            cover: cover,
          });

          processedPaths.add(novelPath);
        }
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

    /* ============================================================
     COVER, NAME, AUTHOR, STATUS, GENRE
     Structure:
     div.unit.mtop10
       div.frame.fm
         ul > li
           div.lf2 > img[src]      → cover
           div.rt5
             h1                    → title
             p (author)            → "作者：伊人为花"
             p (status)            → "状态：已完结"
             p (ignore)
             p (genre)             → "类别：玄幻"
             p (ignore)
    ============================================================ */

    const $info = $('div.unit.mtop10 div.frame.fm ul li');

    // --- Cover ---
    const cover = $info.find('div.lf2 img').attr('src')?.trim() || defaultCover;

    // --- Novel name ---
    const novelName = $info.find('div.rt5 h1').text().trim();

    // --- Author ---
    let rawAuthor = $info.find('div.rt5 > p').eq(0).text().trim();
    let author = rawAuthor.replace(/^作者：/, '').trim();

    // --- Status ---
    let rawStatus = $info.find('div.rt5 > p').eq(1).text().trim();
    rawStatus = rawStatus.replace(/^状态：/, '').trim();
    let status = '';
    if (rawStatus === '已完结') {
      status = NovelStatus.Completed;
    } else if (rawStatus === '连载中') {
      status = NovelStatus.Ongoing;
    } else status = NovelStatus.Unknown;

    // --- Genre ---
    let rawGenre = $info.find('div.rt5 > p').eq(3).text().trim();
    const genreCN = rawGenre.replace(/^类别：/, '').trim();
    // Map genre names to English
    const genreMap: Record<string, string> = {
      '玄幻': 'Xianxia',
      '轻小说': 'Slice of Life',
      '幻情': 'Romance',
      '都市小说': 'Urban',
      '穿越小说': 'Time-Travel',
      '现言': 'Drama',
      '古言': 'Historical',
    };
    const genre = genreMap[genreCN] ?? undefined;

    /* ============================================================
       SUMMARY
       Structure:
       div.unit
         div.intro
           div
             p  ← summary text
    ============================================================ */

    const summary = $('div.unit div.intro div p').text().trim();
    let summary_translate: string | undefined;
    if (summary) {
      summary_translate = await translate(summary, 'ru');
      summary_translate = summary_translate.replace(/<[^>]+>/g, '');
    }

    /* ============================================================
     CHAPTERS — separate URL
    ============================================================ */

    const chapters = await this.loadChapters(novelPath);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: novelName,
      cover: cover ? cover : defaultCover,
      summary: summary_translate,
      author: author,
      genres: genre ? genre : undefined,
      status: status,
      chapters: chapters,
    };

    return novel;
  }

  private async loadChapters(novelPath: string): Promise<Plugin.ChapterItem[]> {
    const chaptersUrl = makeAbsolute(novelPath + 'dir.html', this.site);
    if (!chaptersUrl) return [];
    const result = await fetchApi(chaptersUrl);
    if (!result.ok) return [];

    const $ = parseHTML(await result.text());
    const chapters: Plugin.ChapterItem[] = [];

    /* ============================================================
       Chapter structure:
       ul#lists
         div      ← ignore
         li
           a[href] → path
             div
               span → chapter title
             span → ignore (diamond emoji if not 免费)
       ============================================================ */

    $('#lists li').each((_i, liEl) => {
      const $li = $(liEl);

      const $a = $li.find('a');
      const chapterPath = $a.attr('href')?.trim();

      // Chapter name is inside: a > div > span
      const chapterName = $a.find('div span').first().text().trim();

      if (chapterPath && chapterName) {
        chapters.push({
          name: chapterName,
          path: chapterPath,
          releaseTime: undefined,
        });
      }
    });

    return chapters;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const chapterUrl = makeAbsolute(chapterPath, this.site);
    if (!chapterUrl) throw new Error('Invalid chapter URL');
    console.log('Parsing chapter URL:', chapterUrl);

    let currentUrl = chapterUrl;
    console.log('Starting URL for chapter parsing:', currentUrl);

    // Base path of the chapter, WITHOUT _2, _3 etc
    const initialBase = new URL(chapterUrl).pathname.replace(
      /(_\d+)?\.html$/,
      '',
    );
    console.log('Initial base path:', initialBase);

    const parts: string[] = [];
    let chapterTitle = '';

    let safetyCounter = 0;
    const MAX_PAGES = 30;

    while (currentUrl && safetyCounter < MAX_PAGES) {
      safetyCounter++;

      const result = await fetchApi(currentUrl);
      if (!result.ok) throw new Error(`Failed to fetch: ${currentUrl}`);

      const html = await result.text();
      const $ = parseHTML(html);

      const $root = $('div.rdcon');

      // ===== TITLE (only first part) =====
      if (!chapterTitle) {
        chapterTitle = $root.find('h1').first().text().trim();
      }

      // ===== CONTENT (one part) =====
      let text = $root.find('div > p').not('.rdbt').first().text().trim();

      // remove continuation notification
      text = text.replace('内容未完，下一页继续阅读', '').trim();

      if (text) {
        const translated = await translateHtmlByLinePlain(text, 'ru', 'zh-TW');
        parts.push(translated);
      }

      // ===== NEXT PAGE LINK =====
      const nextRel = $root
        .find('ul#zhangjieinfo li')
        .eq(2)
        .find('a')
        .attr('href');
      console.log('Next part relative URL:', nextRel);
      if (!nextRel) break;

      const nextUrl = makeAbsolute(nextRel, this.site);
      if (!nextUrl) break;
      console.log('Next part URL:', nextUrl);

      // ===== detect if this is TRUE next part or next CHAPTER =====
      const nextBase = nextRel.replace(/(_\d+)?\.html$/, '');
      console.log('Next base path:', nextBase);

      // 🔥 STOP if it's a new chapter
      if (nextBase !== initialBase) break;

      // otherwise continue to next part
      currentUrl = nextUrl;
    }

    const fullHtml = parts.join('<br>');
    if (!fullHtml.trim()) return 'Error: Chapter content empty';

    return `<h1>${chapterTitle}</h1> 🐼<br>${fullHtml}`;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo < 1) return [];

    // Construct search URL for this site
    const searchUrl = `${this.site}book/Search.aspx?key=${encodeURIComponent(searchTerm)}`;

    const result = await fetchApi(searchUrl);
    if (!result.ok) return [];

    const html = await result.text();
    const $ = parseHTML(html);

    const novels: Plugin.NovelItem[] = [];

    // Select all <li> items in the search result list
    $('#result li').each((_i, li) => {
      const $li = $(li);

      // --- COVER + MAIN LINK ---
      // First <a> contains the image and the href path
      const $firstLink = $li.find('a').first();
      const novelPath = $firstLink.attr('href')?.trim();
      const cover = $firstLink.find('img').attr('src')?.trim() || defaultCover;

      // --- TITLE ---
      // The second <a> inside the <div> contains <h1> with the title
      const novelName = $li.find('div a h1').text().trim();

      if (novelPath && novelName) {
        novels.push({
          name: novelName,
          path: novelPath,
          cover: cover,
        });
      }
    });

    return novels;
  }
}

export default new TuyePlugin();

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
