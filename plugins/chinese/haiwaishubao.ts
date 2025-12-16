import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class HaiWaiPlugin implements Plugin.PluginBase {
  id = 'haiwaishubao';
  name = '海外书包';
  site = 'https://www.haiwaishubao.com/';
  version = '1.0.0';
  icon = 'src/cn/haiwaishubao/favicon.png';

  imageRequestInit = {
    headers: {
      Referer: this.site,
    },
  };

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    // site shows everything on one page — stop if page > 1
    if (pageNo > 1) return [];

    const url = `${this.site}rank/`;
    const result = await fetchApi(url);
    if (!result.ok) return [];

    const $ = parseHTML(await result.text());
    const novels: Plugin.NovelItem[] = [];
    const processedPaths = new Set<string>();

    // ---------- 1) Parse the grid/list in sectionTwo -> div.book_list_img ul li ----------
    $('section.sectionTwo div.sectionTwo-content div.book_list_img ul li').each(
      (_i, liEl) => {
        const $li = $(liEl);

        // Cover is inside div.book_img_pic > a > img
        const $img = $li.find('div.book_img_pic a img').first();
        const cover =
          $img.attr('src')?.trim() ||
          $img.attr('_src')?.trim() ||
          $img.attr('data-src')?.trim() ||
          $img.attr('data-original')?.trim() ||
          defaultCover;

        // Title + path are inside div.book_img_name > a
        const $titleLink = $li.find('div.book_img_name a').first();
        const novelPath = $titleLink.attr('href')?.trim();
        const novelName = $titleLink.text().trim();

        if (novelPath && novelName && !processedPaths.has(novelPath)) {
          novels.push({ name: novelName, path: novelPath, cover });
          processedPaths.add(novelPath);
        }
      },
    );

    // ---------- 2) Parse the ranking / right column units (many .CGsectionTwo-right-content-unit) ----------
    $(
      'section.CGsectionTwo div.CGsectionTwo-right div.CGsectionTwo-right-content div.CGsectionTwo-right-content-unit',
    ).each((_i, unitEl) => {
      const $unit = $(unitEl);

      // The anchor with the title sits in p > span > a (per your structure)
      const $a = $unit.find('p span a').first();
      const novelPath = $a.attr('href')?.trim();
      const novelName = $a.text().trim();

      // there may be a small cover inside label.RKsection-rangking-img or nearby img
      // try to find an img near this unit
      let cover = defaultCover;

      if (novelPath && novelName && !processedPaths.has(novelPath)) {
        novels.push({ name: novelName, path: novelPath, cover });
        processedPaths.add(novelPath);
      }
    });

    // Return parsed novels (order preserved as found on page)
    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    // Resolve relative -> absolute and fetch page
    const novelUrl = makeAbsolute(novelPath, this.site);
    if (!novelUrl) throw new Error('Invalid novel URL');

    const result = await fetchApi(novelUrl);
    if (!result.ok) throw new Error('Failed to fetch novel');

    const $ = parseHTML(await result.text());

    /* ============================================================
       SELECTORS BASED ON NEW STRUCTURE
       - Cover: section.BGsectionOne -> div.BGsectionOne-top -> div.BGsectionOne-top-left img
       - Title:  section.BGsectionOne -> div.BGsectionOne-top-right p.title
       - Author: section.BGsectionOne -> div.BGsectionOne-top-right p.author span a
       - Category/Genre: p.category span a (text)
       - Chapters entry point: section.BGsectionOne-bottom ul li > a  (collect anchors)
       - Summary: section.BGsectionTwo div.BGsectionTwo-bottom (collect paragraphs)
    ============================================================ */

    // --- Cover ---
    const $coverImg = $(
      'section.BGsectionOne div.BGsectionOne-top div.BGsectionOne-top-left img',
    ).first();
    const cover =
      $coverImg.attr('src')?.trim() ||
      $coverImg.attr('data-src')?.trim() ||
      $coverImg.attr('_src')?.trim() ||
      $coverImg.attr('data-original')?.trim() ||
      defaultCover;

    // --- Title ---
    const novelName = $(
      'section.BGsectionOne div.BGsectionOne-top div.BGsectionOne-top-right p.title',
    )
      .first()
      .text()
      .trim();

    // --- Author ---
    let author = '';
    const $authorAnchor = $(
      'section.BGsectionOne div.BGsectionOne-top div.BGsectionOne-top-right p.author span a',
    ).first();
    if ($authorAnchor.length) {
      author = $authorAnchor.text().trim();
    }

    // --- Genre (map CN -> english / normalized) ---
    const genreMap: Record<string, string> = {
      '高辣小说': 'Smut',
      '百合肉文': 'Yuri',
      '言情小说': 'Romance',
      '情欲小说': 'Ecchi',
      '耽美小说': 'Yaoi',
    };

    let genre: string | undefined;
    const $genreAnchor = $(
      'section.BGsectionOne div.BGsectionOne-top div.BGsectionOne-top-right p.category span a',
    ).first();
    if ($genreAnchor.length) {
      const rawGenre = $genreAnchor.text().trim();
      genre = genreMap[rawGenre] ?? 'Other';
    } else {
      genre = 'Other';
    }

    // --- Status detection ---
    let status = NovelStatus.Unknown;

    // --- Summary (collect paragraphs inside BGsectionTwo-bottom) ---
    let summary = '';
    $('section.BGsectionTwo div.BGsectionTwo-bottom').each((_i, el) => {
      // gather all <p> inside this block (some sites put links or labels we ignore)
      $(el)
        .find('p')
        .each((_j, p) => {
          const t = $(p).text().trim();
          if (t) {
            if (summary) summary += '\n\n' + t;
            else summary = t;
          }
        });
    });

    // (Optional) If you want an automatic translation, call your translate(...) here.
    const summary_translated = summary
      ? await translate(summary, 'ru')
      : undefined;

    // --- Chapters: gather anchors in BGsectionOne-bottom ul li a ---
    /* ============================================================
     CHAPTERS — separate URL
    ============================================================ */
    let chaptersAnchor = $('section.BGsectionThree > a')
      .first()
      .attr('href')
      ?.trim();
    let chapters: Plugin.ChapterItem[] = [];
    if (chaptersAnchor != undefined) {
      chapters = await this.loadChapters(chaptersAnchor);
    }

    // Build result object
    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: novelName || '',
      cover: cover || defaultCover,
      summary: summary_translated || undefined,
      author: author || undefined,
      genres: genre ? genre : undefined,
      status,
      chapters,
    };

    return novel;
  }

  private async loadChapters(novelPath: string): Promise<Plugin.ChapterItem[]> {
    const chapters: Plugin.ChapterItem[] = [];

    // The first page is always the base novelPath
    const firstPageUrl = makeAbsolute(novelPath, this.site);
    if (!firstPageUrl) return [];

    // --- Step 1: Load the FIRST chapter page ---
    const firstResult = await fetchApi(firstPageUrl);
    if (!firstResult.ok) return [];

    const firstHtml = await firstResult.text();
    const $first = parseHTML(firstHtml);

    /* ==========================================================
       Step 2: Gather all chapter-list page URLs
       ========================================================== */

    let pageUrls = new Set<string>();

    // Select element with list of pages
    const $select = $first('select#indexselect');

    if ($select.length > 0) {
      // Each <option value="..."> is a chapter list page
      $select.find('option').each((_i, opt) => {
        const value = $first(opt).attr('value')?.trim();
        if (value) {
          const abs = makeAbsolute(value, this.site);
          if (abs) pageUrls.add(abs);
        }
      });
    } else {
      // Fallback: only 1 page exists (the first page)
      pageUrls.add(firstPageUrl);
    }

    /* ==========================================================
       Step 3: Load ALL pages (1 or many)
       ========================================================== */

    // Convert Set → Array to avoid ES2015 iteration requirement
    const pageList = Array.from(pageUrls);

    for (const pageUrl of pageList) {
      const result = await fetchApi(pageUrl);
      if (!result.ok) continue;

      const html = await result.text();
      const $ = parseHTML(html);

      /* ==========================================================
         Chapter structure (new):
         section.BCsectionTwo
           ol.BCsectionTwo-top
             li.BCsectionTwo-top-chapter
               a[href] → chapter path
                 text → chapter name
         ========================================================== */

      $(
        'section.BCsectionTwo ol.BCsectionTwo-top li.BCsectionTwo-top-chapter',
      ).each((_i, li) => {
        const $li = $(li);
        const $a = $li.find('a').first();

        const chapterPath = $a.attr('href')?.trim();
        const chapterName = $a.text().trim();

        if (chapterPath && chapterName) {
          chapters.push({
            name: chapterName,
            path: chapterPath,
            releaseTime: undefined,
          });
        }
      });
    }

    return chapters;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    // ----------------------------------------------------------
    // 1) Build absolute URL and validate
    // ----------------------------------------------------------
    const chapterUrl = makeAbsolute(chapterPath, this.site);
    if (!chapterUrl) throw new Error('Invalid chapter URL');

    let currentUrl = chapterUrl;

    // Base path WITHOUT "_2.html", "_3.html", etc
    const initialBase = new URL(chapterUrl).pathname.replace(
      /(_\d+)?\.html$/,
      '',
    );

    const parts: string[] = [];
    let chapterTitle = '';

    let safetyCounter = 0;
    const MAX_PAGES = 30;

    // ----------------------------------------------------------
    // 2) Loop: load page, extract content, follow “next page”
    // ----------------------------------------------------------
    while (currentUrl && safetyCounter < MAX_PAGES) {
      safetyCounter++;

      const result = await fetchApi(currentUrl);
      if (!result.ok) throw new Error(`Failed to fetch: ${currentUrl}`);

      const html = await result.text();
      const $ = parseHTML(html);

      /* ==========================================================
         TITLE — taken only once
         Structure:
           section.RBGsectionOne > h1
         ========================================================== */
      if (!chapterTitle) {
        chapterTitle = $('section.RBGsectionOne h1').first().text().trim();
      }

      /* ==========================================================
         CONTENT
         Structure:
           section.RBGsectionThree
             div.RBGsectionThree-content#content
               (...inner HTML...)
         ========================================================== */

      const $content = $('section.RBGsectionThree div#content');
      let text = $content.text().trim();

      if (text) {
        const translated = await translateHtmlByLinePlain(text, 'ru', 'zh-TW');
        parts.push(translated);
      }

      /* ==========================================================
         NEXT PAGE LINK
         Structure:
           section.RBGsectionTwo ul li.RBGsectionTwo-right a[href]
         ========================================================== */

      const nextRel = $('section.RBGsectionTwo li.RBGsectionTwo-right a')
        .first()
        .attr('href');

      if (!nextRel) break;

      const nextUrl = makeAbsolute(nextRel, this.site);
      if (!nextUrl) break;

      // ----------------------------------------------------------
      // STOP if this link is actually to the NEXT CHAPTER
      // ----------------------------------------------------------
      const nextBase = nextRel.replace(/(_\d+)?\.html$/, '');

      if (nextBase !== initialBase) {
        // It's a different chapter → stop
        break;
      }

      currentUrl = nextUrl;
    }

    // ----------------------------------------------------------
    // 3) Build the final output HTML
    // ----------------------------------------------------------
    const fullHtml = parts.join('<br>');
    if (!fullHtml.trim()) return 'Error: Chapter content empty';

    return `<h1>${chapterTitle}</h1><br>${fullHtml}`;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo < 1) return [];

    const searchUrl = `${this.site}search/`;

    // --- Step 1: POST request with the search term ---
    const result = await fetchApi(searchUrl, {
      method: 'POST',
      body: `searchkey=${encodeURIComponent(searchTerm)}&searchtype='all'&submit=''`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    });

    if (!result.ok) return [];

    const html = await result.text();
    const $ = parseHTML(html);

    const novels: Plugin.NovelItem[] = [];

    /* ==========================================================
       Each search result is inside:
       section.SHsectionThree > div.SHsectionThree-middle > p > span > a
       span > a[href] → novel path
       text inside a → novel title
       Ignore "/" and other spans
       ========================================================== */
    $('section.SHsectionThree div.SHsectionThree-middle p').each((_i, p) => {
      const $p = $(p);

      $p.find('span').each((_j, span) => {
        const $span = $(span);
        const $a = $span.find('a').first();
        if (!$a.length) return;

        const novelPath = $a.attr('href')?.trim();
        const novelName = $a.text().trim();

        if (novelPath && novelName && novelName !== '/') {
          novels.push({
            name: novelName,
            path: novelPath,
            cover: defaultCover, // search page does not show covers
          });
        }
      });
    });

    return novels;
  }
}

export default new HaiWaiPlugin();

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
