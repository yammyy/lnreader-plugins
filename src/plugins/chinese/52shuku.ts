import { load as parseHTML } from 'cheerio';
import { fetchApi, fetchFile } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class shuku52Plugin implements Plugin.PluginBase {
  id = '52shuku';
  name = '52书库';
  site = 'https://www.52shuku.net/';
  version = '9.5.0';
  icon = 'src/cn/52shuku/faviconV2.png';

  imageRequestInit = {
    headers: {
      Referer: this.site,
    },
  };

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];

    const result = await fetchApi(this.site);
    if (!result.ok) return [];

    const $ = parseHTML(await result.text());
    const novels: Plugin.NovelItem[] = [];
    const processedPaths = new Set<string>();

    // Traverse all "div.relates" inside section > div.content-wrap > div.content
    $('div.relates').each((_i, relatesEl) => {
      const $relates = $(relatesEl);

      // Inside relates → ul > li
      $relates.find('ul li').each((_j, liEl) => {
        const $li = $(liEl);

        // Look for <a> tag inside li
        const $link = $li.find('a');
        const novelPath = $link.attr('href')?.trim();
        const novelName = $link.text().trim();

        if (novelPath && novelName && !processedPaths.has(novelPath)) {
          novels.push({
            name: novelName,
            path: novelPath,
            cover: defaultCover, // No cover in your described structure
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

    // === Novel name + Author ===
    let rawName = $('header.article-header h1').text().trim();

    // === Status ===
    let detail: 'Completed' | 'Unknown' = 'Unknown';
    if (rawName.includes('【完结')) {
      detail = 'Completed';
      rawName = rawName.replace(/【完结】/, '').trim();
      rawName = rawName.replace(/【完结+番外】/, '').trim();
    }

    // Remove anything inside 【…】 from rawName
    rawName = rawName.replace(/【[^】]*】/g, '').trim();

    // Split by "_" to separate author
    let novelName = rawName;
    let author: string | undefined;
    if (rawName.includes('_')) {
      const parts = rawName.split('_');
      novelName = parts.slice(0, -1).join('_').trim(); // everything except last
      author = parts[parts.length - 1].trim();
    }

    // === Summary ===
    // Take the second <p> that is not .con_pc
    let summary = $('article.article-content > p')
      .not('.con_pc')
      .map((_, el) => $(el).text().trim())
      .get()[1]; // get second element (index 1)
    let summary_translate: string | undefined;
    if (summary) {
      summary_translate = await translate(summary, 'ru');
      summary_translate = summary_translate.replace(/<[^>]+>/g, ''); // strip tags just in case
    }

    // === Chapters ===
    const chapters: Plugin.ChapterItem[] = [];
    $('article.article-content ul.list.clearfix li.mulu a').each((_i, el) => {
      const $el = $(el);
      const chapterPath = ($el.attr('href') ?? '').trim();
      const chapterName = $el.text().trim();

      if (chapterPath && chapterName) {
        chapters.push({
          name: chapterName,
          path: chapterPath,
          releaseTime: undefined,
        });
      }
    });

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: novelName,
      cover: defaultCover, // no cover in this structure
      summary: summary_translate,
      author: author,
      genres: undefined,
      status:
        detail === 'Completed' ? NovelStatus.Completed : NovelStatus.Unknown,
      chapters: chapters,
    };

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const chapterUrl = makeAbsolute(chapterPath, this.site);
    if (!chapterUrl) throw new Error('Invalid chapter URL');

    const result = await fetchApi(chapterUrl);
    if (!result.ok) throw new Error('Failed to fetch chapter');

    const $ = parseHTML(await result.text());

    // === Target container ===
    const $content = $('article.article-content');
    if (!$content.length) return 'Error: Could not find chapter content';

    // === Remove junk ===
    $content
      .find(
        'script, style, iframe, button, hr, [class*="ads"], [id*="ads"], [class*="recommend"], [class*="pagination2"]',
      )
      .remove();

    // Remove comments
    $content.contents().each((_i, node) => {
      if (node.type === 'comment') $(node).remove();
    });

    // Remove known junk blocks
    $content.find('#lineCorrect, [id*="52shuku"], [class*="52shuku"]').remove();

    // Remove paragraphs containing 52shuku text or spans
    $content.find('p').each((_i, el) => {
      const $p = $(el);
      if ($p.text().includes('52书库') || $p.find('span').length > 0) {
        $p.remove();
      }
    });

    $content.find('div').each((_i, div) => {
      $(div).replaceWith($(div).html() || '');
    });

    const chapterTitleRegex = /^第\s*\d+\s*章/;
    $content.find('p').each((_i, el) => {
      const $p = $(el);
      const text = $p.text().trim();

      if (chapterTitleRegex.test(text)) {
        $p.replaceWith(`<h1>${text}</h1>`);
      }
    });

    // === Final HTML ===
    const rawHtml = $content.html() || '';
    if (!rawHtml) return 'Error: Chapter content was empty';
    let chapterText = '';

    if (rawHtml.trim()) {
      chapterText = await translateHtmlByLinePlain(rawHtml, 'ru');
    } else {
      chapterText = ''; // or keep as is, no translation
    }

    chapterText = chapterPath + '🐼<br><br>' + chapterText;

    return chapterText.trim();
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    // Search URL format
    const searchUrl = `${this.site}so/search.php?q=${encodeURIComponent(
      searchTerm,
    )}&m=&f=_all&s=&p=${pageNo}`;

    const result = await fetchApi(searchUrl);
    if (!result.ok) return [];

    const body = await result.text();
    const $ = parseHTML(body);
    const novels: Plugin.NovelItem[] = [];

    $('article.excerpt header h2 a').each((_i, el) => {
      const $el = $(el);

      const novelPath = $el.attr('href')?.trim();
      let novelName = $el.text().trim(); // this will contain tags like <em>

      // Strip tags like <em> from novelName
      novelName = novelName.replace(/<[^>]+>/g, '').trim();

      if (novelPath && novelName) {
        novels.push({
          name: novelName,
          path: novelPath,
          cover: defaultCover, // no cover in search results
        });
      }
    });

    return novels;
  }
}

export default new shuku52Plugin();

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
