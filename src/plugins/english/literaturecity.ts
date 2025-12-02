import { load as parseHTML } from 'cheerio';
import { fetchText, fetchApi } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { encode } from 'urlencode';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { storage } from '@libs/storage';

class literatureCityPlugin implements Plugin.PluginBase {
  id = 'litcity';
  name = 'Literature City';
  icon = 'src/en/litcity/favicon.png';
  site = 'https://literaturecity.com/';
  version = '1.0.0';

  hideLocked = storage.get('hideLocked');
  pluginSettings = {
    hideLocked: {
      value: '',
      label: 'Hide premium chapters',
      type: 'Switch',
    },
  };

  // Fetches popular novels from LiteratureCity new ranking page
  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    // Only page 1 has results — the ranking page isn't paginated
    if (pageNo > 1) return [];

    const url = this.site + 'ranking/?sort=popularity';
    const novels: Plugin.NovelItem[] = [];
    const processedPaths = new Set<string>();

    const result = await fetchApi(url);
    if (!result.ok) return novels;

    const $ = parseHTML(await result.text());

    // Select all novel items inside the ranking list
    $('div.ranking-novel-list > div.ranking-novel-item').each((_i, el) => {
      const $item = $(el);

      // --- Extract novel path + cover from the first <a> ---
      const $firstA = $item.find('a').first();
      const novelPath = $firstA.attr('href')?.trim() || '';

      const novelCover =
        $firstA.find('img').attr('src')?.trim() ||
        $firstA.find('img').attr('data-src')?.trim() ||
        defaultCover;

      // --- Extract novel name from <p class="ranking-novel-item-title"> ---
      const novelName = $item.find('p.ranking-novel-item-title').text().trim();

      // Avoid duplicates + ensure required fields exist
      if (novelPath && novelName && !processedPaths.has(novelPath)) {
        novels.push({
          name: novelName,
          path: novelPath,
          cover: novelCover,
        });

        processedPaths.add(novelPath);
      }
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const novelUrl = makeAbsolute(novelPath, this.site);
    if (!novelUrl) throw new Error('Invalid novel URL');

    const result = await fetchApi(novelUrl);
    if (!result.ok) throw new Error('Failed to fetch novel page');

    const $ = parseHTML(await result.text());

    // ======== NOVEL NAME ========
    const novelName = $('h1.title').text().trim() || 'Untitled Novel';

    // ======== COVER ========
    const cover = $('img#novel_cover').attr('src')?.trim() || defaultCover;

    // ======== STATUS ========
    const rawStatus = $('a#novel_status').text().trim();
    let status = '';
    const s = rawStatus.toLowerCase();
    if (s.includes('completed')) status = NovelStatus.Completed;
    else if (s.includes('active')) status = NovelStatus.Ongoing;
    else if (s.includes('on hold')) status = NovelStatus.OnHiatus;
    else if (s.includes('dropped')) status = NovelStatus.Cancelled;
    else status = NovelStatus.Unknown;
    console.log('Status:', status);

    // ======== GENRES ========
    const genres = $('div#tags_div a.novel_genre')
      .map((_i, el) => $(el).text().trim())
      .get()
      .filter(g => g.length > 0)
      .join(', ');

    // ======== SUMMARY ========
    // Collect all <p> inside .desc_div, combine into one string
    let summary = $('div.desc_div p')
      .map((_i, el) => $(el).text().trim())
      .get()
      .join('\n\n');

    // ======== CHAPTER LIST ========
    const chapters: Plugin.ChapterItem[] = [];

    // Select all chapter links (.premium_chap and .free_chap)
    $('div.novel_index a').each((_i, el) => {
      const $a = $(el);

      const isPremium = $a.hasClass('premium_chap');

      // Determine locked status
      const locked = isPremium === true;

      // Skip locked chapters if user wants to hide them
      if (locked && this.hideLocked) {
        return; // Skip this chapter
      }

      // -------------------------------
      // Extract chapter name
      // -------------------------------
      let chapterName = '';

      if (isPremium) {
        // Premium chapter -> name is inside <p>
        chapterName = $a.find('p').text().trim();
        // Add diamond emoji
        chapterName = `💎 ${chapterName}`;
      } else {
        // Free chapter -> name is text of <a>
        chapterName = $a.text().trim();
      }
      if (!chapterName) return;

      const chapterPath = $a.attr('href')?.trim();
      if (!chapterPath) return;

      chapters.push({
        name: chapterName,
        path: chapterPath,
        releaseTime: undefined,
      });
    });

    // ======== RESULT ========
    return {
      path: novelPath,
      name: novelName,
      cover,
      summary,
      author: undefined, // site doesn't provide author in this DOM
      genres,
      status,
      chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const chapterUrl = makeAbsolute(chapterPath, this.site);
    if (!chapterUrl) throw new Error('Invalid chapter URL');

    const result = await fetchApi(chapterUrl);
    if (!result.ok) throw new Error('Failed to fetch chapter');

    const $ = parseHTML(await result.text());

    // ======== CHAPTER TITLE ========
    const title = $('div.bs-header h1.title').first().text().trim() || '';

    // ======== CHAPTER CONTENT ========
    // Only get <p class="chapter_content"> inside <article>
    const $article = $('article').first();
    if (!$article.length) return 'Error: Could not find chapter article';

    const $paragraphs = $article.find('p.chapter_content');
    if (!$paragraphs.length) return 'Error: Chapter content was empty';

    // Combine all paragraphs into HTML
    const rawHtml = $paragraphs
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
    // Construct URL for first page vs subsequent pages
    let searchUrl = `${this.site}novels/?search=${encodeURIComponent(searchTerm)}&type=&language=&status=&sort=`;
    if (pageNo > 1) {
      searchUrl = `${this.site}novels/page/${pageNo}/?search=${encodeURIComponent(
        searchTerm,
      )}&type=&language=&status=&sort=`;
    }

    const result = await fetchApi(searchUrl);
    if (!result.ok) {
      throw new Error('Failed to fetch search results');
    }

    const html = await result.text();
    const $ = parseHTML(html);

    const novels: Plugin.NovelItem[] = [];

    // Iterate through all novels in the search results
    $('div.novel-list a.novel-item').each((_i, el) => {
      const $a = $(el);

      const novelPath = $a.attr('href')?.trim();
      const novelCover =
        $a.find('img.novel-item-Cover').attr('src')?.trim() || defaultCover;
      const novelName = $a.find('p.novel-item-title').text().trim();

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

export default new literatureCityPlugin();

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
