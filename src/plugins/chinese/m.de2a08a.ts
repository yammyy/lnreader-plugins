import { load as parseHTML } from 'cheerio';
import { fetchApi, fetchText } from '@libs/fetch';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { Plugin } from '@typings/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { defaultCover } from '@libs/defaultCover';

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
  site = 'https://m.de2a0a8.xyz';
  version = '1.3.0';

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
    const authorText = $infoSection
      .find('div.book_box dl dd.dd_box span')
      .first()
      .text()
      .trim();
    const author = authorText.replace(/^.*?作者：/, '').trim() || undefined;

    // --- Status ---
    const statusText = $infoSection
      .find('div.book_box dl dd.dd_box span')
      .eq(1) // second span
      .text()
      .trim();
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

    // --- Chapter list link ---
    const chapterListPath = $infoSection.find('div.book_more a').attr('href');

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: novelName || 'Untitled',
      cover: novelCover,
      summary: summary || undefined,
      author,
      genres: undefined, // not available here
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

    return chapterHtml;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];

    // Search URL with query param
    const searchUrl = `${this.site}/s?q=${encodeURIComponent(searchTerm)}`;

    const body = await fetchText(searchUrl, this.fetchOptions);
    if (body === '') throw Error('无法获取搜索结果，请检查网络');

    const $ = parseHTML(body);
    const novels: Plugin.NovelItem[] = [];

    $('div.wrap div.block.so_list div.hot div.item').each((_, el) => {
      const novelPath = $(el).find('div.image a').attr('href');
      const novelCover = $(el).find('div.image a img').attr('src');
      const novelName = $(el).find('div.image a img').attr('alt');

      if (!novelPath) return;

      novels.push({
        name: novelName?.trim() || 'Untitled',
        cover: novelCover || undefined,
        path: novelPath.replace(this.site, ''),
      });
    });

    return novels;
  }
}

export default new mde2a08aPlugin();
