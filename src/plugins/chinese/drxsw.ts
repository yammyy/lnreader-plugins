import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class drxswPlugin implements Plugin.PluginBase {
  id = 'drxsw';
  name = '冬日小说网';
  site = 'https://www.drxsw.com/';
  version = '23.0.3';
  icon = 'src/cn/drxsw/logo.png';

  imageRequestInit = {
    headers: {
      Referer: this.site,
    },
  };

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    //There is only one page to this site
    if (pageNo > 1) return [];

    let url = `${this.site}`;
    const result = await fetchApi(url);
    if (!result.ok) return [];

    const $ = parseHTML(await result.text());
    const novels: Plugin.NovelItem[] = [];
    const processedPaths = new Set<string>();

    const $recombooks = $('div.recombook');

    $recombooks.find('dl').each((_i, el) => {
      const $el = $(el);
      let novelPath: string | undefined;
      let novelName: string | undefined;
      let novelCover: string | undefined;

      const $link = $el.find('dt a');
      novelPath = $link.attr('href')?.trim();
      novelCover = $link.find('img').attr('data-src')?.trim();
      novelName = $link.find('img').attr('alt')?.trim();

      if (novelPath && novelName) {
        novels.push({
          name: novelName,
          path: novelPath,
          cover: makeAbsolute(novelCover, this.site) || defaultCover,
        });
        processedPaths.add(novelPath);
      }
    });

    $('div.w_440').each((_i, el) => {
      const $el = $(el);
      $el.find('dl').each((_j, eldl) => {
        const $eldl = $(eldl);
        let novelPath: string | undefined;
        let novelName: string | undefined;
        let novelCover: string | undefined;

        const $link = $eldl.find('dt a');
        novelPath = $link.attr('href')?.trim();
        novelCover = $link.find('img').attr('data-src')?.trim();
        novelName = $link.find('img').attr('alt')?.trim();

        if (novelPath && novelName) {
          novels.push({
            name: novelName,
            path: novelPath,
            cover: makeAbsolute(novelCover, this.site) || defaultCover,
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
    const $novel = $('div#bookinfo');
    const $novelInfo = $novel.find('div.bookright');
    const $novelCover = $novel.find('div.bookleft');

    let coverURL = makeAbsolute(
      $novelCover.find('div#bookimg img').attr('src'),
      this.site,
    );

    let authorName = $novelInfo
      .find('div.d_title .p_author')
      .text()
      .replace(/\uFEFF/g, '') // BOM
      .replace(/\u00A0/g, ' ')
      .replace(/^.*[:：]/, '')
      .trim();

    const novelStatus = $novelInfo
      .find('div#count ul li')
      .first()
      .find('span')
      .text()
      .trim();
    let detail: 'Ongoing' | 'Completed' | 'Unknown' = 'Unknown';
    if (novelStatus === '连载中') {
      detail = NovelStatus.Completed;
    } else if (novelStatus === '已完结') {
      detail = NovelStatus.Ongoing;
    } else {
      detail = NovelStatus.Unknown;
    }

    const $bookIntro = $novelInfo.find('#bookintro');
    // Replace <p> and </p> with newlines, then strip other tags
    let summary = $bookIntro
      .html()
      ?.replace(/<p[^>]*>/g, '') // opening <p> tags → nothing
      .replace(/<\/p>/g, '\n') // closing </p> tags → newline
      .replace(/<br>/g, '\n') // closing <br> tags → newline
      .replace(/<[^>]+>/g, '') // remove any remaining tags
      .trim();
    let summary_translate: string | undefined;
    if (summary !== undefined) {
      summary_translate = await translate(summary, 'ru');
      summary_translate = summary_translate.replace(/<[^>]+>/g, ''); // remove any remaining tags
    } else {
      summary_translate = undefined;
    }

    const $genre = $('div.tabstit')
      .contents() // получаем детей, включая текст
      .filter((_, el) => el.type === 'text') // оставляем только текстовые узлы
      .map((_, el) => (el as any).data.trim()) // берём текст
      .get()
      .filter(txt => txt.length > 0); // убираем пустые строки
    let genre = $genre[0] || '';
    switch (genre) {
      case '玄幻小说':
        genre = 'Fantasy';
        break;
      case '武俠小说':
        genre = 'Martial Arts';
        break;
      case '都市小说':
        genre = 'Urban';
        break;
      case '歷史小说':
        genre = 'Historical';
        break;
      case '遊戲小说':
        genre = 'Games';
        break;
      case '科幻小说':
        genre = 'Sci-fi';
        break;
      case '恐怖小说':
        genre = 'Horror';
        break;
      case '其他小说':
        genre = 'Other';
        break;
    }

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: $novelInfo.find('div.d_title h1').text().trim(),
      cover: coverURL || defaultCover,
      summary: summary_translate,
      author: authorName || undefined,
      genres: genre,
      status: detail,
      chapters: [],
    };

    const chapter: Plugin.ChapterItem[] = [];
    const $chapterList = $('#chapterList');
    $chapterList.find('li a').each((_i, el) => {
      const $el = $(el);
      const chapterPath = ($el.attr('href') ?? '').trim();
      const chapterName = $el.text().trim();
      chapter.push({
        name: chapterName,
        path: chapterPath,
        releaseTime: undefined,
      });
    });
    novel.chapters = chapter;

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const chapterUrl = makeAbsolute(chapterPath, this.site);
    if (!chapterUrl) throw new Error('Invalid chapter URL');

    let result = await fetchApi(chapterUrl);
    if (!result.ok) throw new Error(`Failed to fetch chapter at ${chapterUrl}`);

    let html = await result.text();

    // --- Parse content ---
    // Get title of the chapter
    const $ = parseHTML(html);
    let title = $('div.mlfy_main_text h1').text().trim();

    // Get chapter content
    const $content = $('#TextContent');
    if (!$content.length) {
      return `Error: Could not find chapter content at ${chapterUrl}`;
    }

    // Remove known junk nodes
    $content
      .find('script, style, ins, iframe, .ads, .ad, .copy, .footer')
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
    if (pageNo > 1) return [];
    const searchUrl = `${this.site}/s.php`;

    const result = await fetchApi(searchUrl, {
      method: 'POST',
      body: `searchkey=${encodeURIComponent(searchTerm)}&searchtype=articlename`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
    });

    // --- Handle Cloudflare / Captcha ---
    if (result.status === 403) {
      throw new Error('Captcha detected (HTTP 403), please open in webview.');
    }

    const html = await result.text();
    const $ = parseHTML(html);

    // --- Parse novels from results ---
    const novels: Plugin.NovelItem[] = [];

    $('dl#nr').each((_i, el) => {
      const $el = $(el);

      const novelPath = $el.find('dd h3 a').attr('href')?.trim();
      const novelName = $el.find('dd h3 a').text().trim();
      const novelCover =
        $el.find('dt a img').attr('data-src')?.trim() ||
        $el.find('dt a img').attr('src')?.trim();

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

export default new drxswPlugin();

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
