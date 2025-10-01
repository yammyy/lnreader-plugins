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

class drxswPlugin implements Plugin.PluginBase {
  id = 'drxsw';
  name = '冬日小说网';
  site = 'https://www.drxsw.com/';
  version = '5.0.2';
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
      const $recomclass = $el.find('dl').each((_j, eldl) => {
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

    const novelStatus = $novelInfo
      .find('div#count ul li')
      .first()
      .find('span')
      .text()
      .trim();
    let detail: 'Ongoing' | 'Completed' | 'Unknown' = 'Unknown';
    if (novelStatus === '连载中') {
      detail = 'Completed';
    } else if (novelStatus === '已完结') {
      detail = 'Ongoing';
    } else {
      detail = 'Unknown';
    }

    const $bookIntro = $novelInfo.find('#bookintro');
    // Replace <p> and </p> with newlines, then strip other tags
    let summary = $bookIntro
      .html()
      ?.replace(/<p[^>]*>/g, '\n') // opening <p> tags → newline
      .replace(/<\/p>/g, '') // closing </p> tags → nothing
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
        genre = 'Sci-Fi';
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
      cover:
        makeAbsolute(
          $novel.find('div.bookleft div#bookimg img').attr('src'),
          this.site,
        ) || defaultCover,
      summary: summary_translate,
      author:
        $novelInfo
          .find('div.d_title .p_author')
          .text()
          .replace(/\uFEFF/g, '') // BOM
          .replace(/\u00A0/g, ' ')
          .replace(/^.*[:：]/, '')
          .trim() || undefined,
      genres: genre,
      status:
        detail === 'Ongoing'
          ? NovelStatus.Ongoing
          : detail === 'Completed'
            ? NovelStatus.Completed
            : NovelStatus.Unknown,
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
    const $ = parseHTML(html);
    const $title = $('div.mlfy_main_text h1');
    let title = $title.text().trim();
    title = await translate(title, 'ru');
    const $content = $('#TextContent');

    if (!$content.length) {
      return `Error: Could not find chapter content at ${chapterUrl}`;
    }

    // Remove known junk nodes
    $content
      .find('script, style, ins, iframe, .ads, .ad, .copy, .footer')
      .remove();

    // Extract cleaned text
    let chapterText = $content.html();
    if (!chapterText) return 'Error: Chapter content was empty';
    chapterText = parseHTML(`<div>${chapterText}</div>`).text();

    chapterText = await translate(chapterText, 'ru');

    return `<h1>${title}</h1> ${chapterText.trim()}`;
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
