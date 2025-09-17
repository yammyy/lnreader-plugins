import { load as parseHTML } from 'cheerio';
import { fetchApi, fetchFile } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

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

class shuku52Plugin implements Plugin.PluginBase {
  id = '52shuku';
  name = '52书库';
  site = 'https://www.52shuku.net/';
  version = '1.4.4';
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
      summary: summary,
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

    // === Target the main content container ===
    const $content = $('div.content.contentmargin article.article-content');
    if (!$content.length) return 'Error: Could not find chapter content';

    // === Remove junk elements ===
    $content
      .find(
        'script, style, iframe, button, hr, div, [class*="ads"], [id*="ads"], [class*="recommend"]',
      )
      .remove();

    // === Remove <p> that are clearly junk ===
    $content.find('p').each((_i, el) => {
      const $p = $(el);
      const pText = $p.text().trim();

      // Remove if:
      // - Empty
      // - Contains certain junk phrases
      // - Contains <span> tag
      if (pText.length === 0 || $p.find('span').length > 0) {
        $p.remove();
      }
    });

    // === Remove comments ===
    $content
      .contents()
      .filter(function () {
        return this.type === 'comment';
      })
      .remove();

    // === Convert remaining HTML to plain text ===
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

    return chapterText;
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
