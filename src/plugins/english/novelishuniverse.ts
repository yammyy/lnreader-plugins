import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { storage } from '@libs/storage';

class novelishuniversePlugin implements Plugin.PluginBase {
  id = 'novelishuniverse';
  name = 'Novelish Universe';
  site = 'https://novelishuniverse.com/';
  version = '1.0.0';
  icon = 'src/en/novelishuniverse/favicon.png';

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

    $('div.hotstack div.hotoday div.inhotoday').each((_i, liEl) => {
      const $li = $(liEl);

      /* ----------- LINK, PATH, TITLE ----------- */
      const $link = $li.find('a').first();
      const novelPath = $link.attr('href')?.trim() || '';
      const novelName = $link.attr('oldtitle')?.trim() || '';

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

  private parseDateToISO(dateStr: string): string {
    // Example input: "December 12, 2025"
    const date = new Date(dateStr);

    if (isNaN(date.getTime())) return '';

    return date.toISOString().slice(0, 10); // YYYY-MM-DD
  }

  private formatChapterNumber(raw: string): number {
    // raw example: "Ch. 155"
    const match = raw.match(/Ch\.\s*(\d+)/i);
    return match ? Number(match[1]) : 0;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    console.log('ShanghaiFantasyPlugin: parseNovel:', novelPath);
    const novelUrl = novelPath;
    if (!novelUrl) throw new Error('Invalid novel URL');
    console.log('Parsing novel:', novelUrl);

    const result = await fetchApi(novelUrl);
    if (!result.ok) throw new Error('Failed to fetch novel');

    const $ = parseHTML(await result.text());

    const $container = $('div.insertobig').first();

    // --- Cover ---
    const cover =
      $container.find('div.sertothumb > img').first().attr('src')?.trim() ||
      defaultCover;
    console.log('Cover URL:', cover);

    const $meta = $container.find('div.sertoinfo').first();

    // --- Title ---
    const titlePart1 = $meta.find('h1').first().text().trim();
    const titlePart2 = $meta.find('span.alter').first().text().trim();
    const novelName = (
      titlePart1 + (titlePart2 ? ` - ${titlePart2}` : '')
    ).trim();

    // --- Author ---
    const $labelBlock = $container.find('div.sertoauth').first();

    // Defensive: if the block is found, parse ordered <p> children
    let author: string | undefined;
    let artist: string | undefined;

    if ($labelBlock && $labelBlock.length) {
      // Container with all <p class="text-sm ...">
      const $ps = $labelBlock.find('div.serl');

      // Loop through each <.serl> in the block
      $ps.each(function () {
        const $p = $(this);

        // The label in <span> — for example "Author:", "Raw Title:", etc.
        const label = $p.find('span.sername').first().text().trim();

        // The value is p-text minus the label text
        const value = $p.find('span.serval').first().text().trim();

        switch (label) {
          case 'Author':
            author = value;
            break;

          case 'Artist':
            author = value;
            break;

          // Ignored fields
          case 'Native Language':
          case 'Released':
          case 'Type':
            break;

          default:
            // Unknown label → ignore silently
            break;
        }
      });

      // Debug logs
      console.log('Author: ', author);
      console.log('Artist: ', artist);
    }

    const rating10 = $meta
      .find('div.serrate div.numscore')
      .first()
      .text()
      .trim();
    console.log('Rating:', rating10);
    const rating = parseFloat(rating10) / 2;

    const summary = $container
      .find('div.sersysn div.entry-content')
      .first()
      .text()
      .trim();

    const genres = $container
      .find('div.sertogenre a')
      .map((_, el) => $(el).text().trim())
      .get()
      .join(', ');

    const statusText = $meta
      .find('div.sertostat span')
      .first()
      .text()
      .trim()
      .toLowerCase();
    let status = '';
    if (statusText.includes('ongoing')) {
      status = NovelStatus.Ongoing;
    } else if (statusText.includes('completed')) {
      status = NovelStatus.Completed;
    } else if (statusText.includes('hiatus')) {
      status = NovelStatus.OnHiatus;
    } else {
      status = NovelStatus.Unknown;
    }

    /* ============================================================
       CHAPTERS (via separate URL)
    ============================================================ */

    const novelId = $meta
      .find('div.serbookmark div.serbookmark')
      .attr('data-id');
    console.log('Novel ID (post): ', novelId);

    const chapters: Plugin.ChapterItem[] = [];

    // 2️⃣ Select chapter list
    const $lis = $('div.eplisterfull ul > li');

    $lis.each((index, li) => {
      const $li = $(li);

      /* -------------------------------
         Chapter ID → path
      -------------------------------- */
      const postId = $li.attr('data-id');

      const path = `https://novelishuniverse.com/wp-json/wp/v2/posts/${postId}`;

      /* -------------------------------
         Chapter number
      -------------------------------- */
      const rawNum = $li
        .find('.epl-num')
        .contents()
        .filter((_, node) => node.type === 'text')
        .text()
        .trim();

      const chapterNumber = this.formatChapterNumber(rawNum);
      const paddedNumber = String(chapterNumber).padStart(5, '0');

      /* -------------------------------
         Premium (🍁 → 💎)
      -------------------------------- */
      const isPremium = $li.find('.epl-num img').length > 0;
      const prefix = isPremium ? '💎 ' : '';

      if (isPremium && this.hideLocked) {
        return;
      }

      /* -------------------------------
         Title
      -------------------------------- */
      const title =
        $li.find('.epl-title').text().trim() || `Chapter ${chapterNumber}`;

      /* -------------------------------
         Release date
      -------------------------------- */
      const rawDate = $li.find('.epl-date').text().trim();
      const releaseTime = rawDate ? this.parseDateToISO(rawDate) : '';

      /* -------------------------------
         Push result
      -------------------------------- */
      chapters.push({
        name: `${prefix}Chapter ${paddedNumber}. ${title}`,
        path,
        releaseTime,
      });
    });

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: novelName || 'Untitled',
      cover: cover,
      summary: summary,
      author: author,
      genres: genres,
      status: status,
      chapters: chapters,
      rating: isNaN(rating) ? undefined : rating,
    };

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    if (!chapterPath) throw new Error('Invalid chapter URL');

    console.log('Parsing chapter:', chapterPath);

    const chapterApiUrl = chapterPath;

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

    const cleanedContent = contentHtml.replace(/<h2[^>]*>.*?<\/h2>/i, '');

    /* ---------------------------------------------------------
       STEP 5: Build final HTML
    --------------------------------------------------------- */
    const chapterHtml = `
      <h1>${title}</h1><br>
      ${cleanedContent}
    `.trim();

    return chapterHtml;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const novels: Plugin.NovelItem[] = [];

    // Construct URL for first page vs subsequent pages
    let searchUrl = `${this.site}/?s=${encodeURIComponent(searchTerm)}`;
    if (pageNo > 1) {
      searchUrl = `${this.site}/page/${pageNo}/?s=${encodeURIComponent(searchTerm)}`;
    }

    const result = await fetchApi(searchUrl);
    if (!result.ok) {
      throw new Error('Failed to fetch search results');
    }

    const html = await result.text();
    const $ = parseHTML(html);

    // Iterate through all novels in the search results
    $('div.listupd article.maindet').each((_i, el) => {
      const $article = $(el);
      const $thumbImg = $article.find('div.mdthumb > a > img');
      const $infoLink = $article.find('div.mdinfo > h2 > a');

      const novelCover = $thumbImg.attr('src')?.trim() || defaultCover;
      const novelPath = $infoLink.attr('href')?.trim();
      const novelName = $infoLink.text().trim();

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

export default new novelishuniversePlugin();
