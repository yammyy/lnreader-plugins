import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { storage } from '@libs/storage';

class readHivePlugin implements Plugin.PluginBase {
  id = 'readHive';
  name = 'ReadHive';
  icon = 'src/en/readhive/favicon.jpg';
  site = 'https://readhive.org/';
  version = '10.0.0';

  hideLocked = storage.get('hideLocked');
  pluginSettings = {
    hideLocked: {
      value: '',
      label: 'Hide premium chapters',
      type: 'Switch',
    },
  };

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    // Construct URL
    const url = pageNo === 1 ? this.site : `${this.site}page/${pageNo}/`;

    const novels: Plugin.NovelItem[] = [];
    const processedPaths = new Set<string>();

    const result = await fetchApi(url);
    if (!result.ok) return novels;

    const $ = parseHTML(await result.text());

    // Select all <a class="peer">
    $('a.peer').each((_i, el) => {
      const $a = $(el);

      // --- Novel path ---
      const novelPath = $a.attr('href')?.trim();
      if (!novelPath || processedPaths.has(novelPath)) return;

      // --- Cover ---
      const $img = $a.find('img').first();
      const novelCover = $img.attr('src')?.trim();

      // --- Novel name (from alt, remove "thumbnail") ---
      let novelName =
        $img
          .attr('alt')
          ?.replace(/thumbnail/i, '')
          .trim() || '';
      if (!novelName) return;

      novels.push({
        name: novelName,
        path: makeAbsolute(novelPath, this.site) || defaultCover,
        cover: novelCover,
      });

      processedPaths.add(novelPath);
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    console.log('Parsing novel:', novelPath);
    const novelUrl = makeAbsolute(novelPath, this.site);
    if (!novelUrl) throw new Error('Invalid novel URL');
    console.log('Novel URL:', novelUrl);

    const result = await fetchApi(novelUrl);
    if (!result.ok) throw new Error('Failed to fetch novel page');

    const $ = parseHTML(await result.text());

    // ======== NOVEL NAME ========
    const novelName = $('h1').first().text().trim() || 'Untitled Novel';
    console.log('Novel Name:', novelName);

    // ======== COVER ========
    const cover =
      $('img.object-cover.w-full').first().attr('src')?.trim() || defaultCover;
    console.log('Cover URL:', cover);

    // ======== STATUS ========
    // The site doesn't seem to provide status in new DOM
    const status = NovelStatus.Unknown;
    console.log('Status:', status);

    // ======== GENRES ========
    const genres = $('a.text-foreground')
      .filter((_i, el) => !$(el).attr('href')?.includes('/register'))
      .map((_i, el) => $(el).text().trim())
      .get()
      .filter(g => g.length > 0)
      .join(', ');
    console.log('Genres:', genres);

    // ======== SUMMARY ========
    // Find h2 containing "Synopsis", get next sibling div.mb-4, then collect all <p>
    let summary = '';
    const synopsisHeader = $('h2')
      .filter((_i, el) => $(el).text().trim().toLowerCase() === 'synopsis')
      .first();

    if (synopsisHeader.length) {
      summary = synopsisHeader
        .next('div.mb-4')
        .find('p')
        .map((_i, el) => $(el).text().trim())
        .get()
        .join('\n\n');
    }
    console.log('Summary:', summary);

    // ======== CHAPTER LIST ========
    const chapters: Plugin.ChapterItem[] = [];

    // Find h3 with text "Table of Contents" and its next sibling div
    const tocHeader = $('h3')
      .filter(
        (_i, el) => $(el).text().trim().toLowerCase() === 'table of contents',
      )
      .first();

    const tocDiv = tocHeader.next('div');
    tocDiv.find('div > a').each((_i, el) => {
      const $a = $(el);

      const chapterPath = $a.attr('href')?.trim();
      if (!chapterPath) return;

      // Determine if chapter is locked (has a span inside)
      // True if <a> has any direct <span> children
      const locked = $a.children('span').length > 0;

      if (locked && this.hideLocked) return; // skip if user wants to hide locked chapters

      // Chapter name is inside div > div > div > span
      let chapterName = $a.find('span.ml-1').first().text().trim();
      console.log('Chapter Name (before fallback):', chapterName);

      if (!chapterName) {
        // fallback: use text inside <a>
        chapterName = $a.text().trim();
      }
      console.log('Chapter Name (after fallback):', chapterName);

      if (locked) chapterName = `💎 ${chapterName}`;
      console.log('Final Chapter Name:', chapterName);

      if (!chapterName) return;

      chapters.push({
        name: chapterName,
        path: chapterPath,
        releaseTime: undefined,
      });
    });
    console.log('Total chapters parsed:', chapters.length);

    // ======== RESULT ========
    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: novelName,
      cover,
      summary,
      author: undefined, // site doesn't provide author
      genres,
      status,
      chapters,
    };
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const chapterUrl = makeAbsolute(chapterPath, this.site);
    if (!chapterUrl) throw new Error('Invalid chapter URL');

    const result = await fetchApi(chapterUrl);
    if (!result.ok) throw new Error('Failed to fetch chapter');

    const $ = parseHTML(await result.text());

    // ======== CHAPTER TITLE ========
    // Use <title> inside <head>
    const title = $('head title').first().text().trim() || '';

    // ======== CHAPTER CONTENT ========
    const $main = $('main').first();
    if (!$main.length) return 'Error: Could not find main';

    // Third div inside main
    const $thirdDiv = $main.children('div').eq(2);
    if (!$thirdDiv.length) return 'Error: Could not find third div inside main';

    // First div inside third div
    const $contentDiv = $thirdDiv.children('div').first();
    if (!$contentDiv.length) return 'Error: Could not find content div';

    // Get all <p> inside, ignoring nested divs
    const rawHtml = $contentDiv
      .find('p')
      .filter((_i, el) => $(el).parents('div').first()[0] === $contentDiv[0])
      .map((_i, el) => $(el).html()?.trim() || '')
      .get()
      .join('<br>');

    // Prepend title and panda emoji
    const fullHtml = `<h1>${title}</h1>🐼<br>${rawHtml}`;

    return fullHtml;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo !== 1) return []; // search only supports first page
    const url = `${this.site}ajax`;

    const body = new URLSearchParams({
      query: searchTerm,
      action: 'search',
    });

    const result = await fetchApi(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!result.ok) {
      throw new Error('Failed to fetch search results');
    }

    const json = await result.json();
    if (!json.success || !Array.isArray(json.data)) return [];

    const novels: Plugin.NovelItem[] = json.data.map((item: any) => ({
      name: item.title?.trim() || 'Untitled Novel',
      path: item.url,
      cover: makeAbsolute(item.thumb, this.site) || defaultCover,
    }));

    return novels;
  }
}

export default new readHivePlugin();

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
