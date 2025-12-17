import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class aerialrainPlugin implements Plugin.PluginBase {
  id = 'aerialrain';
  name = 'Aerial Rain Translation';
  site = 'https://aerialrain.com/';
  version = '1.0.0';
  icon = 'src/en/aerialrain/favicon.png';

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return []; // Site has onle home page for novels

    const url = this.site;
    console.log('Fetching ', url);

    const res = await fetchApi(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch ${this.site} : ${res.status}`);
    }

    const $ = parseHTML(await res.text());

    const novels: Plugin.NovelItem[] = [];

    // Iterate through all divs with class "cat-card"
    $('div.cat-card').each((_i, cardEl) => {
      const $card = $(cardEl);

      // Skip if it contains <h2 class="cat-title">Latest Chapters</h2>
      const catTitleText = $card.find('h2.cat-title').first().text().trim();
      if (catTitleText.toLowerCase() === 'latest chapters') return;

      // Get novel cover from div.cat-thumb > img
      const cover = makeAbsolute(
        $card.find('div.cat-thumb img').attr('src'),
        this.site,
      );

      // Get novel title and path from div.cat-content > h2.cat-title > a
      const $a = $card.find('div.cat-content h2.cat-title a').first();
      const title = $a.text().trim();
      const path = makeAbsolute($a.attr('href'), this.site);

      novels.push({
        name: title || 'Untitled',
        path: path || '',
        cover: cover || defaultCover,
      });
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    console.log(novelPath);
    const res = await fetchApi(novelPath);
    if (!res.ok) {
      console.log(res.status);
      throw new Error('Failed to load novel page: ' + res.status);
    }

    const $ = parseHTML(await res.text());

    // --- Title. Part1 ---
    const mainTitle = $('h1.entry-title').first().text().trim() || '';

    //Block with original title, author and genres
    const firstP = $('div.entry-content > p').first();
    firstP.find('a').remove();
    firstP.find('br').remove();
    const text = firstP
      .text()
      .trim() // Get bare text (strip all remaining tags)
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    //Extract Original Title, Author, Genre using simple regex
    let originalTitle = '';
    let author = '';
    let rawGenres = '';

    const titleMatch = text.match(/Original Title\s*:\s*(.*?)Author\s*:/i);
    if (titleMatch) originalTitle = titleMatch[1].trim();

    const authorMatch = text.match(/Author\s*:\s*(.*?)Genre\s*:/i);
    if (authorMatch) author = authorMatch[1].trim();

    const genreMatch = text.match(/Genre\s*:\s*(.*?)Similar Novels/i);
    if (genreMatch) rawGenres = genreMatch[1].trim();
    // Process genres
    // Known multi-word genres
    const multiWordGenres = [
      'School Life',
      'Slice of Life',
      'Martial Arts',
      'Gender Bender',
      'Shoujo Ai',
      'Shounen Ai',
    ];
    let genres: string[] = [];
    if (rawGenres.includes(',')) {
      // Split by comma only
      genres = rawGenres
        .split(',')
        .map(g => g.trim())
        .filter(Boolean);
    } else {
      // Split by spaces, try to detect multi-word genres
      rawGenres
        .split(/\s(?=[A-Z])/)
        .map(g => g.trim())
        .filter(Boolean)
        .forEach(g => {
          // Merge known multi-word genres
          for (const mw of multiWordGenres) {
            if (g.includes(mw)) g = mw;
          }
          if (!genres.includes(g)) genres.push(g);
        });
    }
    // Replace Adult with Mature if Mature not present
    if (genres.includes('Adult')) {
      genres = genres.map(g => (g === 'Adult' ? 'Mature' : g));
    }
    // Remove duplicates
    genres = Array.from(new Set(genres));
    // Convert to string separated by comma
    const genreString = genres.join(', ');

    // Combine main title and original title
    const name = originalTitle ? `${mainTitle} / ${originalTitle}` : mainTitle;

    // --- COVER IMAGE ---
    let cover = defaultCover;
    $('div.entry-content > p > img').each((_i, imgEl) => {
      const $img = $(imgEl);
      if ($img.parent().is('p')) {
        cover =
          makeAbsolute(
            $img.attr('src') || $img.attr('srcset') || '',
            this.site,
          ) || defaultCover;
        return false; // break after first valid image
      }
    });

    // =========================
    // 4) SUMMARY
    // =========================

    // Select all direct children inside .entry-content (not only <p>)
    const contentEls = $('div.entry-content').children();

    let summary = '';
    let synopsisFound = false;

    contentEls.each((_i, el) => {
      const $el = $(el);
      const text = $el.text().trim();

      // ------------ STOP CONDITIONS ------------
      // Stop if <hr> is encountered
      if (synopsisFound && $el.is('hr')) {
        return false; // break .each
      }

      // Stop if element text contains "Table of contents"
      if (synopsisFound && /table\s+of\s+contents/i.test(text)) {
        return false; // break .each
      }

      // ------------ START CONDITION ------------
      // Detect start of synopsis section
      if (!synopsisFound && /synopsis/i.test(text)) {
        synopsisFound = true;
        return; // continue to next element
      }

      // ------------ COLLECTION ------------
      if (synopsisFound) {
        // Skip empty text nodes or decorative elements
        if (text.length > 0) {
          summary += text + '\n\n';
        }
      }
    });

    // Trim final summary
    summary = summary.trim();

    // =========================
    // 5) CHAPTERS
    // =========================
    const chapters: Plugin.ChapterItem[] = [];
    $('ul.frame-links-list li').each((_i, liEl) => {
      const $a = $(liEl).find('a').first();
      if (!$a.length) return;
      const chapterPath = makeAbsolute($a.attr('href') || '', this.site) || '';
      const chapterName = $a.text().trim() || 'Untitled Chapter';
      chapters.push({
        name: chapterName,
        path: chapterPath,
      });
    });

    console.log('Total chapters', chapters.length);

    // =========================
    // 6) RETURN RESULT
    // =========================
    return {
      path: novelPath,
      name,
      cover,
      author,
      summary,
      genres: genreString,
      status: NovelStatus.Unknown, // could detect completed if needed
      chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const chapterUrl = makeAbsolute(chapterPath, this.site);
    if (!chapterUrl) throw new Error('Invalid chapter URL');

    const result = await fetchApi(chapterUrl);
    if (!result.ok) throw new Error('Failed to fetch chapter');

    const $ = parseHTML(await result.text());

    // =========================
    // 1) Get chapter title
    // =========================
    const title = $('h1.entry-title').first().text().trim() || 'Chapter';

    // =========================
    // 2) Extract chapter content
    // =========================
    const $content = $('div.entry-content').first();

    // Remove comments
    $content.contents().each((_i, node) => {
      if (node.type === 'comment') $(node).remove();
    });

    // =========================
    // 3) Clean elements
    // =========================
    const cleanedBlocks: string[] = [];

    $content.children().each((_i, el) => {
      const $el = $(el);
      const tag = el.tagName?.toLowerCase() || '';

      // -------------------------
      // Remove unwanted leading TOC/nav paragraphs
      // -------------------------
      if (tag === 'p' && /toc|table of contents|next|prev/i.test($el.text())) {
        return; // skip
      }

      // -------------------------
      // Keep only allowed tags
      // -------------------------
      if (tag === 'p') {
        let txt = $el.text().trim();

        if (!txt) return;

        cleanedBlocks.push(`<p>${txt}</p>`);
        return;
      }

      if (tag === 'hr') {
        return; // skip
      }

      // ----- Handle <ol> → <ul> (footnotes cleanup) -----
      if (tag === 'ol') {
        const liList: string[] = [];

        $el.find('li').each((_liIdx, li) => {
          const $li = $(li);

          // Remove footnote anchors, spans, marker icons, etc.
          $li.find('a, span, sup').remove();

          const txt = $li.text().trim();
          if (txt.length > 0) liList.push(`<li>${txt}</li>`);
        });

        if (liList.length > 0) {
          cleanedBlocks.push(`<ul>${liList.join('')}</ul>`);
        }
        return;
      }

      // All other elements are ignored (div, span, etc.)
    });

    // =========================
    // 4) Build final HTML
    // =========================
    const finalHtml =
      `<h1>${title}</h1>` + `🐼<br>\n` + cleanedBlocks.join('\n');

    return finalHtml;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    return [];
  }
}

export default new aerialrainPlugin();

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
