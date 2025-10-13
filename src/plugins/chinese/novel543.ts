import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class Novel543Plugin implements Plugin.PluginBase {
  id = 'novel543';
  name = 'Novel543';
  site = 'https://www.novel543.com/';
  version = '5.0.2';
  icon = 'src/cn/novel543/icon.png';

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

    $('ul.list > li.media, ul.list li > a[href^="/"][href$="/"]').each(
      (_i, el) => {
        const $el = $(el);
        let novelPath: string | undefined;
        let novelName: string | undefined;
        let novelCover: string | undefined;

        if ($el.is('li.media')) {
          const $link = $el.find('.media-content h3 a');
          novelPath = $link.attr('href')?.trim();
          novelName = $link.text().trim();
          novelCover = $el.find('.media-left img').attr('src')?.trim();
        } else if ($el.is('a')) {
          novelPath = $el.attr('href')?.trim();
          novelName =
            $el.find('h3, b, span').first().text().trim() ||
            $el.parent().find('h3').text().trim() ||
            $el.text().trim();
          novelCover =
            $el.find('img').attr('src')?.trim() ||
            $el.parent().find('img').attr('src')?.trim();
        }

        if (
          novelPath &&
          novelName &&
          novelPath.match(/^\/\d+\/$/) &&
          !processedPaths.has(novelPath)
        ) {
          novels.push({
            name: novelName,
            path: novelPath,
            cover: makeAbsolute(novelCover, this.site) || defaultCover,
          });
          processedPaths.add(novelPath);
        }
      },
    );

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const novelUrl = makeAbsolute(novelPath, this.site);
    if (!novelUrl) throw new Error('Invalid novel URL');

    const result = await fetchApi(novelUrl);
    if (!result.ok) throw new Error('Failed to fetch novel');

    const $ = parseHTML(await result.text());
    const $infoSection = $('section#detail div.media div.media-content');
    const $modSection = $('section#detail div.mod');

    // Find the element with both classes: "intro" AND "is-hidden-mobile"
    const introDiv = $('div.intro.is-hidden-mobile');
    // Get plain text
    const summary = introDiv.text().trim();
    let summary_translate = await translate(summary, 'ru');

    let genre = $infoSection
      .find('p.meta a[href*="/bookstack/"]')
      .text()
      .trim();
    switch (genre) {
      case '玄幻':
        genre = 'Fantasy';
        break;
      case '修真':
        genre = 'Cultivation';
        break;
      case '都市':
        genre = 'Urban';
        break;
      case '歷史':
        genre = 'Historical';
        break;
      case '網遊':
        genre = 'Games';
        break;
      case '科幻':
        genre = 'Sci-fi';
        break;
      case '女頻':
        genre = 'Female';
        break;
      case '靈異':
        genre = 'Supernatural';
        break;
      case '同人':
        genre = 'Fan Fiction';
        break;
      case '軍事':
        genre = 'Military';
        break;
      case '懸疑':
        genre = 'Suspense';
        break;
      case '穿越':
        genre = 'Time Travel';
        break;
      case '其它':
        genre = 'Other';
        break;
      case '其他':
        genre = 'Other';
        break;
    }

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: $infoSection.find('h1.title').text().trim() || 'Untitled',
      cover:
        makeAbsolute(
          $('section#detail div.cover img').attr('src'),
          this.site,
        ) || defaultCover,
      summary: summary_translate || undefined,
      author:
        $infoSection.find('p.meta span.author').text().trim() || undefined,
      genres: genre || undefined,
      status: NovelStatus.Unknown,
      chapters: [],
    };

    const chapterListPath =
      $modSection
        .find('p.action.buttons a.button.is-info[href$="/dir"]')
        .attr('href') ||
      $infoSection.find('a.button.is-info[href$="/dir"]').attr('href');

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

    $('div.chaplist ul.all li a').each((index, el) => {
      const $el = $(el);
      const chapterName = $el.text().trim();
      const chapterUrl = $el.attr('href')?.trim();

      if (chapterName && chapterUrl) {
        // основная глава
        chapters.push({
          name: chapterName,
          path: chapterUrl,
          chapterNumber: index + 1,
        });

        // дополнительная страница (вторая часть)
        const altUrl = chapterUrl.replace(/\.html$/, '_2.html');
        chapters.push({
          name: chapterName + ' (part 2)', // можно добавить пометку
          path: altUrl,
          chapterNumber: index + 1.5, // или index + 1, если не хочешь дробные
        });
      }
    });

    const sortButtonText = $('div.chaplist .header button.reverse span')
      .last()
      .text()
      .trim();
    if (sortButtonText === '倒序') {
      chapters.reverse();
      chapters.forEach((chap, index) => (chap.chapterNumber = index + 1));
    }

    return chapters;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const chapterUrl = makeAbsolute(chapterPath, this.site);
    if (!chapterUrl) throw new Error('Invalid chapter URL');

    const result = await fetchApi(chapterUrl);
    if (!result.ok) throw new Error('Failed to fetch chapter');

    const $ = parseHTML(await result.text());
    const $content = $('div.content.py-5');
    if (!$content.length) return 'Error: Could not find chapter content';

    $content
      .find(
        'script, style, ins, iframe, [class*="ads"], [id*="ads"], [class*="google"], [id*="google"], [class*="recommend"], div[align="center"], p:contains("推薦本書"), a[href*="javascript:"]',
      )
      .remove();

    $content.find('p').each((_i, el) => {
      const $p = $(el);
      const pText = $p.text().trim();
      if (
        pText.includes('請記住本站域名') ||
        pText.includes('手機版閱讀網址') ||
        pText.includes('novel543') ||
        pText.includes('稷下書院') ||
        pText.includes('最快更新') ||
        pText.includes('最新章節') ||
        pText.includes('章節報錯') ||
        pText.match(/app|APP|下載|客户端|关注微信|公众号/i) ||
        pText.length === 0 ||
        ($p
          .html()
          ?.replace(/&nbsp;/g, '')
          .trim() === '' &&
          $p.find('img').length === 0) ||
        pText.includes('溫馨提示')
      ) {
        $p.remove();
      }
    });

    $content
      .contents()
      .filter(function () {
        return this.type === 'comment';
      })
      .remove();

    let rawHtml = $content.html() || '';
    if (!rawHtml) return 'Error: Chapter content was empty';
    rawHtml = '🐼<br>' + rawHtml;
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

    if (/^\d+$/.test(searchTerm)) {
      try {
        const novelPath = `/${searchTerm}/`;
        const novel = await this.parseNovel(novelPath);
        return [
          {
            name: novel.name,
            path: novelPath,
            cover: novel.cover,
          },
        ];
      } catch {
        return [];
      }
    }

    const searchUrl = `${this.site}search/${encodeURIComponent(searchTerm)}`;
    let body = '';

    try {
      const result = await fetchApi(searchUrl);
      if (!result.ok) {
        if (result.status === 403 || result.status === 503) {
          throw new Error(
            'Cloudflare protection detected (HTTP error). Please try opening the plugin in WebView first to solve the challenge.',
          );
        }
        return [];
      }

      body = await result.text();
      const $ = parseHTML(body);
      const pageTitle = $('title').text().toLowerCase();

      // Check for various Cloudflare challenge indicators
      if (
        pageTitle.includes('attention required') ||
        pageTitle.includes('just a moment') ||
        pageTitle.includes('please wait') ||
        pageTitle.includes('verifying') ||
        body.includes('Verifying you are human') ||
        body.includes('cf-browser-verification') ||
        body.includes('cf_captcha_container')
      ) {
        throw new Error(
          'Cloudflare protection detected. Please try opening the plugin in WebView first to solve the challenge.',
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        // If it's already our custom error, re-throw it
        if (error.message.includes('Cloudflare protection detected')) {
          throw error;
        }
        // For other errors, throw a generic error
        throw new Error(`Failed to fetch search results: ${error.message}`);
      }
      throw error;
    }

    const $ = parseHTML(body);
    const novels: Plugin.NovelItem[] = [];

    $('div.search-list ul.list > li.media').each((_i, el) => {
      const $el = $(el);
      const $link = $el.find('.media-content h3 a');
      const novelPath = $link.attr('href')?.trim();
      const novelName = $link.text().trim();
      const novelCover = $el.find('.media-left img').attr('src')?.trim();

      if (novelPath && novelName && novelPath.match(/^\/\d+\/$/)) {
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

export default new Novel543Plugin();

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
