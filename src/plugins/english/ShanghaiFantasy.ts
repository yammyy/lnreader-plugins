import { load as parseHTML } from 'cheerio';
import { fetchApi, fetchFile } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { Filters, FilterTypes } from '@libs/filterInputs';
import { storage } from '@libs/storage';

class ShanghaiFantasyPlugin implements Plugin.PluginBase {
  id = 'ShanghaiFantasy';
  name = 'Shanghai Fantasy';
  site = 'https://shanghaifantasy.com/';
  version = '1.0.0';
  icon = 'src/en/shanghaifantasy/favicon.png';

  hideLocked = storage.get('hideLocked');
  pluginSettings = {
    hideLocked: {
      value: '',
      label: 'Hide locked chapters',
      type: 'Switch',
    },
  };

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    // The page lists everything on page 1 only
    if (pageNo > 1) return [];

    const url = `${this.site}`;
    const result = await fetchApi(url);
    if (!result.ok) return [];

    const $ = parseHTML(await result.text());
    const novels: Plugin.NovelItem[] = [];
    const processedPaths = new Set<string>();

    /*  
      The new "popular novels" section is inside:
      <div class="pt-5"> ... <div class="grid ..."> <li>...</li>
    */

    $('div.pt-5 .grid li').each((_i, liEl) => {
      const $li = $(liEl);

      /* ----------- LINK, PATH, TITLE ----------- */
      const $link = $li.find('a').first();
      const novelPath = $link.attr('href')?.trim() || '';
      const novelName = $link.find('p').text().trim();

      /* -------------- COVER IMAGE -------------- */
      const cover = $li.find('img').attr('src')?.trim() || defaultCover;

      /* ----------- VALIDATION + ADD ------------ */
      if (novelPath && novelName && !processedPaths.has(novelPath)) {
        novels.push({
          name: novelName,
          path: novelPath,
          cover: cover,
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
    if (!result.ok) throw new Error('Failed to fetch novel');

    const $ = parseHTML(await result.text());

    /* ============================================================
       COVER, TITLE, AUTHOR, STATUS, GENRE
       New structure:
  
       <div class="max-w-5xl ...">
          <div class="sm:flex">
              <img src="COVER">
              <div>
                  <h1>Title</h1>
                  <div class="flex"> <span>Author:</span> <span>NAME</span> </div>
                  <div class="flex"> <span>Status:</span> <span>Completed</span> </div>
                  <div class="flex"> <span>Genre:</span> <span>Fantasy</span> </div>
              </div>
          </div>
       </div>
    ============================================================ */

    const $container = $('div.mt-10').first();

    // --- Cover ---
    const cover =
      $container.find('img').first().attr('src')?.trim() || defaultCover;

    // Assume $container already points to the 'div.max-w-5xl' (or top container) for this page.

    // --- Title (primary, already extracted earlier) ---
    // e.g. from: const novelName = $container.find('div.ml-5 > p.mb-3').first().text().trim();
    let novelName =
      $container.find('div.ml-5 > p.mb-3').first().text().trim() || 'Untitled';

    // --- The label block: div.ml-5 > div.mb-3 (contains multiple <p>) ---
    const $labelBlock = $container.find('div.ml-5 > div.mb-3').first();

    // Defensive: if the block is found, parse ordered <p> children
    let rawTitle: string | undefined;
    let author: string | undefined;
    let translatedChaptersCount: number | undefined;

    if ($labelBlock && $labelBlock.length) {
      const $ps = $labelBlock.find('p.text-sm'); // selects all <p class="text-sm ...">

      // (1) First p → Raw Title (append to novelName)
      if ($ps.eq(0).length) {
        // The text node after the <span> contains raw title; get full text then remove label
        const firstText = $ps.eq(0).text().trim();
        // Remove leading label like "Raw Title:" (anything before the label's closing span)
        // We'll try to remove the span text if present:
        const spanLabel0 = $ps.eq(0).find('span').first().text().trim();
        rawTitle = firstText.replace(spanLabel0, '').trim();
        if (rawTitle) {
          novelName = `${novelName} / ${rawTitle}`;
        }
      }

      // (2) Second p -> ignore (do nothing)

      // (3) Third p -> Author
      if ($ps.eq(2).length) {
        const p3Text = $ps.eq(2).text().trim();
        const spanLabel3 = $ps.eq(2).find('span').first().text().trim();
        author = p3Text.replace(spanLabel3, '').trim() || undefined;
      }

      // (4) Fourth p -> Translator -> ignore

      // (5) Fifth p -> Update -> ignore

      // (6) Sixth p -> Translated Chapters (number)
      if ($ps.eq(5).length) {
        const p6Text = $ps.eq(5).text().trim();
        const spanLabel6 = $ps.eq(5).find('span').first().text().trim();
        const afterLabel = p6Text.replace(spanLabel6, '').trim();

        // Sometimes the number may be mixed with text; extract first integer found
        const numMatch = afterLabel.match(/(\d+)/);
        if (numMatch) {
          translatedChaptersCount = parseInt(numMatch[1], 10);
        }
      }
    }

    // --- Status ---
    const rawStatus = $container.find('div.ml-5 > a').attr('href')?.trim();
    let status = '';
    if (rawStatus) {
      const s = rawStatus.toLowerCase();
      if (s.includes('Completed')) status = NovelStatus.Completed;
      else if (s.includes('Ongoing')) status = NovelStatus.Ongoing;
      else if (s.includes('Hiatus')) status = NovelStatus.OnHiatus;
      else if (s.includes('Dropped')) status = NovelStatus.Cancelled;
      else status = NovelStatus.Unknown;
    }

    // --- Genre ---// Find the container with all the genre spans
    const $genreContainer = $container.find('div.gap-1');
    // Extract all genre names (each inside an <a> tag)
    const genres = $genreContainer
      .find('a')
      .map(function () {
        return $(this).text().trim(); // take text of each <a>
      })
      .get(); // convert jQuery result to a normal JS array
    console.log(genres);
    const genreString = genres.join(', ');

    /* ============================================================
       SUMMARY
       New structure:
  
       <div id="synopsis">
          <p> ... summary ... </p>
       </div>
    ============================================================ */
    // Select the synopsis block based on the Alpine.js attribute
    const $synopsisBlock = $('div[x-show="activeTab===\'Synopsis\'"]');

    // Extract all <p> text inside the synopsis block
    let summary = $synopsisBlock.find('p').text().trim();
    console.log('Raw summary:', summary);

    /* ============================================================
       CHAPTERS (via separate URL)
    ============================================================ */

    const novelId = Number($('ul#chapterList').attr('data-cat'));

    const chapters = await this.loadShanghaiFantasyChapters(
      novelId,
      translatedChaptersCount || 0,
    );

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: novelName || 'Untitled',
      cover: cover,
      summary: summary,
      author: author,
      genres: genreString,
      status: status,
      chapters: chapters,
    };

    return novel;
  }

  /**
   * Fetches all chapters from Shanghaifantasy API.
   * @param id - Novel ID (category)
   * @param translatedCount - Count of chapters already translated (for LNReader’s numbering)
   */
  private async loadShanghaiFantasyChapters(
    id: number,
    translatedCount: number,
  ): Promise<Plugin.ChapterItem[]> {
    const chapters: Plugin.ChapterItem[] = [];

    // --- API settings ---
    const pageSize = 100; // Default: big chunks
    let currentPage = 1; // Start from page #1
    let totalPages = Math.ceil(translatedCount / pageSize); // Will be updated after first request

    // Continue fetching until all pages are loaded
    while (currentPage <= totalPages) {
      // Build API URL
      const url =
        `${this.site}wp-json/fiction/v1/chapters?` +
        `category=${id}&order=asc&page=${currentPage}&per_page=${pageSize}`;

      console.log('Fetching chapters:', url);

      // --- Perform request ---
      const res = await fetchApi(url);
      if (!res.ok) {
        console.warn('Failed to load page', currentPage);
        break;
      }

      const json = await res.json();
      console.log('Page JSON:', json);
      // Validate: API returns an ARRAY of chapter objects
      if (!Array.isArray(json)) break;

      // Process each chapter
      json.forEach((c: any) => {
        /* -------------------------------
          Step 1: Chapter counter
        ------------------------------- */
        const chapterNumber = chapters.length + 1;
        // DO NOT add translatedCount, because the API already limits pages.

        /* -------------------------------
          Step 2: Release time
          (API does not provide it!)
        ------------------------------- */
        const releaseTime = undefined;

        /* -------------------------------
          Step 3: Locked / VIP
        ------------------------------- */
        const locked = c.locked === true;

        let prefix = '';
        if (locked) prefix = '🔒 ';

        if (locked && this.hideLocked) {
          return; // skip
        }

        /* -------------------------------
          Step 4: Title + path
        ------------------------------- */
        const title = c.title?.trim() || `Chapter ${chapterNumber}`;
        const path = c.permalink || '';

        chapters.push({
          name: `${prefix}Chapter ${String(chapterNumber).padStart(5, '0')}. ${title}`,
          path,
          releaseTime,
        });
      });

      currentPage++;
    }

    return chapters;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    if (!chapterPath) throw new Error('Invalid chapter URL');

    console.log('Parsing chapter:', chapterPath);

    /* ---------------------------------------------------------
       STEP 1: Download chapter webpage HTML
    --------------------------------------------------------- */
    const htmlResult = await fetchApi(chapterPath);

    if (!htmlResult.ok) {
      throw new Error('Failed to load chapter HTML');
    }

    const html = await htmlResult.text();

    // Load HTML into cheerio parser
    const $ = parseHTML(html);

    /* ---------------------------------------------------------
       STEP 2: Extract chapter ID from hidden input
       Example: <input type="hidden" name="comment_post_ID" value="1284828">
    --------------------------------------------------------- */
    const id = $("input[name='comment_post_ID']").attr('value');

    if (!id) {
      throw new Error('Failed to extract chapter ID from page');
    }

    const chapterApiUrl = `https://shanghaifantasy.com/wp-json/wp/v2/posts/${id}`;

    console.log('Chapter ID:', id);
    console.log('Loading JSON:', chapterApiUrl);

    /* ---------------------------------------------------------
       STEP 3: Request WP JSON for this chapter
    --------------------------------------------------------- */
    const apiResult = await fetchApi(chapterApiUrl);

    if (!apiResult.ok) {
      throw new Error('Failed to load chapter JSON');
    }

    const json = await apiResult.json();

    /* ---------------------------------------------------------
       STEP 4: Extract title and content
    --------------------------------------------------------- */
    const title = json?.title?.rendered?.trim() || 'Untitled Chapter';
    const contentHtml = json?.content?.rendered || '';

    if (!contentHtml) {
      return 'Error: Chapter content is empty';
    }

    /* ---------------------------------------------------------
       STEP 5: Build final HTML
    --------------------------------------------------------- */
    const chapterHtml = `
      <h1>${title}</h1><br>
      ${contentHtml}
    `.trim();

    return chapterHtml;
  }

  async searchNovel(query: string, page = 1): Promise<any[]> {
    // 1. Build API URL
    const apiUrl =
      `https://shanghaifantasy.com/wp-json/fiction/v1/novels/` +
      `?novelstatus=&term=&page=${page}&orderby=&order=&query=${encodeURIComponent(query)}`;

    console.log('Searching novels:', apiUrl);

    // 2. Make GET request
    const response = await fetch(apiUrl);

    if (!response.ok) {
      throw new Error('Failed to fetch novels');
    }

    // 3. Parse JSON
    const data = await response.json();

    if (!Array.isArray(data)) {
      console.warn('searchNovel: unexpected response:', data);
      return [];
    }

    // 4. Normalize to LnReader's internal format
    const novels = data.map(item => ({
      title: item.title ?? '',
      path: item.permalink ?? '', // page URL
      cover: item.novelImage ?? '',
      intro: item.novelIntro ?? '',
      genres: item.novelGenres ?? [],
      status: item.novelStat ?? '',
    }));

    return novels;
  }
}

export default new ShanghaiFantasyPlugin();
