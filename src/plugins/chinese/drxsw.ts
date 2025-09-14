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

class drxswPlugin implements Plugin.PluginBase {
  id = 'drxsw';
  name = '冬日小说网';
  site = 'https://www.drxsw.com/';
  version = '1.5.15';
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

    const tabstitHtml = $('div.tabstit').html() || '';
    //There is a problem with layout in source, so
    // Match any characters ending with '小说' after a > or </i> tag
    const genreMatch = tabstitHtml.match(/＞([^＞<]*?小说)/);
    const genre = genreMatch?.[1].trim();

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: $novelInfo.find('div.d_title h1').text().trim(),
      cover:
        makeAbsolute(
          $novel.find('div.bookleft div#bookimg img').attr('src'),
          this.site,
        ) || defaultCover,
      summary: summary,
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
    const $content = $('#TextContent');

    if (!$content.length) {
      return `Error: Could not find chapter content at ${chapterUrl}`;
    }

    // Remove known junk nodes
    $content
      .find('script, style, ins, iframe, .ads, .ad, .copy, .footer')
      .remove();

    // Get HTML instead of plain text
    const chapterHtml = $content.html()?.trim() || '';
    return chapterHtml;
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
