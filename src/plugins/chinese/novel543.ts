import { load as parseHTML } from 'cheerio';
import { fetchApi, fetchFile } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

/**
 * Разбивает текст на абзацы
 */
/**
 * Разбивает текст на логические абзацы
 * Делит по <br> и <p> тегам
 */
function splitParagraphs(htmlText: string): string[] {
  let text = htmlText
    // <p> и </p> превращаем в переносы строк
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    // <br> превращаем в переносы строк
    .replace(/<br\s*\/?>/gi, '\n')
    // убираем все оставшиеся теги
    .replace(/<[^>]+>/g, '')
    // нормализуем пробелы
    .replace(/\u3000/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim();

  // разбиваем по переносам строк (одиночным или двойным)
  const paragraphs = text
    .split(/\n+/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  return paragraphs;
}

/**
 * Делим длинный абзац на куски по знакам препинания или словам
 */
function splitLongParagraph(
  paragraph: string,
  maxChunkSize: number = 1000,
): string[] {
  if (paragraph.length <= maxChunkSize) return [paragraph];

  // сначала делим по "силовым" разделителям
  const delimiters = /([。.!?！？])/g;
  let parts = paragraph.split(delimiters).reduce((acc: string[], curr) => {
    if (acc.length === 0) return [curr];
    if ((acc[acc.length - 1] + curr).length > maxChunkSize) acc.push(curr);
    else acc[acc.length - 1] += curr;
    return acc;
  }, [] as string[]);

  // если всё ещё длинные куски, делим по словам
  parts = parts.flatMap(p => {
    if (p.length <= maxChunkSize) return [p];
    const words = p.split(/\s+/);
    const wordChunks: string[] = [];
    let current = '';
    for (const w of words) {
      if ((current + ' ' + w).trim().length > maxChunkSize) {
        if (current) wordChunks.push(current.trim());
        current = w;
      } else {
        current = (current + ' ' + w).trim();
      }
    }
    if (current) wordChunks.push(current.trim());
    return wordChunks;
  });

  return parts;
}

/**
 * Основная функция, создающая готовые к переводу куски
 */
export function makeChunksFromHTML(
  htmlText: string,
  maxChunkSize: number = 1000,
): string[] {
  const paragraphs = splitParagraphs(htmlText);
  const chunks: string[] = [];

  for (const p of paragraphs) {
    const pChunks = splitLongParagraph(p, maxChunkSize);
    chunks.push(...pChunks);
  }

  return chunks;
}

/**
 * Перевод одного куска текста через Google Translate
 */
async function translateChunk(
  chunk: string,
  targetLang: string,
): Promise<string> {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=${targetLang}&dt=t&q=${encodeURIComponent(chunk)}`;
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(
      `Translate request failed with status ${res.status} ${chunk}`,
    );
  const data = await res.json();
  return data[0].map((d: any) => d[0]).join('');
}

/**
 * Основная функция перевода
 * Используется как: await translate('текст для перевода', 'ru')
 */
export async function translate(
  text: string,
  targetLang: string,
): Promise<string> {
  if (text.length < 2) return text;
  const chunks = makeChunksFromHTML(text, 1000);

  const translations: string[] = [];
  for (const chunk of chunks) {
    const translated = await translateChunk(chunk, targetLang);
    translations.push(translated);
    // пауза 500ms между запросами, чтобы снизить нагрузку на сервис
    await new Promise(r => setTimeout(r, 500));
  }

  // return translations.join('<br>\n\n');
  return translations.map(p => `<p>${p}</p>`).join('\n');
}

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
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return undefined;
  }
};

class Novel543Plugin implements Plugin.PluginBase {
  id = 'novel543';
  name = 'Novel543';
  site = 'https://www.novel543.com/';
  version = '4.0.1';
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
        genre = 'Sci-Fi';
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

    let chapterText = $content.html();
    if (!chapterText) return 'Error: Chapter content was empty';

    chapterText = chapterText
      .replace(/<\s*p[^>]*>/gi, '\n\n')
      .replace(/<\s*br[^>]*>/gi, '\n');

    chapterText = parseHTML(`<div>${chapterText}</div>`).text();

    chapterText = chapterText
      .replace(/[\t ]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    chapterText = await translate(chapterText, 'ru');

    return chapterText;
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
