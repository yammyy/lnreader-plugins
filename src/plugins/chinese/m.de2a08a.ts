import { load as parseHTML } from 'cheerio';
import { fetchApi, fetchText } from '@libs/fetch';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { Plugin } from '@typings/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';

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

class mde2a08aPlugin implements Plugin.PluginBase {
  private fetchOptions = {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,us;q=0.5',
      'Referer': 'https://m.de2a0a8.xyz/', // Referer
      'DNT': '1', // Do Not Track
      'Upgrade-Insecure-Requests': '1', // Upgrade-Insecure-Requests
    },
  };

  id = 'bokuge';
  name = '笔趣阁';
  icon = 'src/cn/mde2a0a8/icon.png';
  site = 'https://m.57ae58c447.cfd/';
  version = '6.1.1';

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
        genre = 'History';
        break;
      case '网游':
        genre = 'Games';
        break;
      case '科幻':
        genre = 'Science Fiction';
        break;
      case '女生':
        genre = 'Girls';
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
    const chapterUrl = new URL(chapterPath, this.site).toString();
    const body = await fetchText(chapterUrl, this.fetchOptions);

    const $ = parseHTML(body);

    // Select the chapter content container
    const $content = $('#chaptercontent').clone();

    // Remove all direct <p> children (but keep other tags)
    $content.children('p').remove();

    // Get cleaned HTML
    const chapterHtml =
      $content
        .html()
        ?.trim()
        // Optionally filter ads or junk strings if needed
        .replace(/69书吧/g, '') || '';

    const translated_chapter = await translate(chapterHtml, 'ru');

    return translated_chapter;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    // This site only returns first page, so skip others
    if (pageNo > 1) return [];

    // Build URL for XHR JSON endpoint
    const params = new URLSearchParams({ q: searchTerm, so: 'undefined' });
    const url = `${this.site}user/search.html?q=${encodeURIComponent(searchTerm)}&so=undefined`;

    // Fetch JSON directly
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'application/json,text/javascript,*/*;q=0.01',
      },
    });

    if (!response.ok) throw new Error('Failed to fetch search results');

    const data = await response.json();

    throw new Error(data.length());

    // Map JSON into Plugin.NovelItem[]
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

export default new mde2a08aPlugin();
