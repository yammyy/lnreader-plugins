import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class aihristdreamPlugin implements Plugin.PluginBase {
  id = 'aihristdream';
  name = 'Ai Hrist Dream Translations';
  site = 'https://www.aihristdreamtranslations.com/';
  version = '3.0.0';
  icon = 'src/en/aihristdream/favicon.jpg';

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return []; // Menu does not paginate

    const url = this.site;
    console.log('Fetching home page URL:', url);

    const res = await fetchApi(url);
    if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

    const $ = parseHTML(await res.text());
    const novels: Plugin.NovelItem[] = [];

    // IDs containing our novel lists
    const menuIds = ['menu-item-23', 'menu-item-56386', 'menu-item-37537'];

    // Loop through each target menu block
    for (const id of menuIds) {
      const $menu = $(`li#${id}`);

      if ($menu.length === 0) continue; // Skip if not found

      // Inside each menu: ul.sub-menu > li > a
      $menu.find('ul.sub-menu li a').each((_i, el) => {
        const $a = $(el);

        const title = $a.text().trim() || 'Unknown';
        const path = makeAbsolute($a.attr('href') || '', this.site);

        novels.push({
          name: title,
          path: path || '',
          cover: defaultCover, // No covers in the menu structure
        });
      });
    }

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    console.log('Parsing novel page:', novelPath);

    const res = await fetchApi(novelPath);
    if (!res.ok) throw new Error('Failed to load novel page: ' + res.status);

    const html = await res.text();
    const $ = parseHTML(html);

    // ======================================================
    // 1) MAIN DOM ELEMENTS
    // ======================================================
    const $article = $('main#main article').first();
    const $content = $article.find('div.entry-content').first();

    // ======================================================
    // 2) TITLE
    // ======================================================
    const mainTitle = $article
      .find('header.entry-header h1.entry-title')
      .first()
      .text()
      .trim();

    let secondaryTitle = '';
    let author = '';
    let genres = '';
    let status = '';

    // ======================================================
    // 3) COVER IMAGE
    // ======================================================
    let cover = defaultCover;

    const $img = $content.find('div.wp-block-image figure img').first();
    if ($img.length) {
      cover = makeAbsolute($img.attr('src') || '', this.site) || defaultCover;
    }

    // ======================================================
    // 4) PROCESS <p> TAGS (dynamic metadata)
    // ======================================================
    // These may contain: Title:, Written by:, Category:, Status:, Description:
    const pList = $content.find('> p');

    let collectingDescription = false;
    let descriptionParts: string[] = [];
    let blockquoteSummary = $content
      .find('blockquote')
      .text()
      .trim()
      .replace(/^Description:\s*/i, '')
      .trim();
    let h5AuthorRaw = $content.find('h5').text().trim();
    let h5Author = '';
    if (/^Written by:/i.test(h5AuthorRaw)) {
      let raw = h5AuthorRaw.replace(/^Written by:\s*/i, '').trim();
      // Remove brackets: 小小牧童 (Xiao Xiao Mutong) -> 小小牧童
      raw = raw.replace(/\(.*?\)/g, '').trim();
      h5Author = raw;
    }

    pList.each((_i, pEl) => {
      const $p = $(pEl);

      // Clean tag content: remove <a>, <br>, etc.
      const $clone = $p.clone();
      $clone.find('a').remove();
      $clone.find('br').remove();
      let text = $clone.text().trim();

      if (!text) return;

      // =============================
      // Start collecting description
      // =============================
      if (/^Description:/i.test(text)) {
        collectingDescription = true;
        return;
      }

      // =============================
      // Stop collecting description
      // =============================
      if (collectingDescription) {
        if (/table\s+of\s+contents/i.test(text)) {
          collectingDescription = false;
          return;
        }
        if (!$p.is('hr')) descriptionParts.push(text);
        return;
      }

      // =============================
      // Secondary Title
      // =============================
      if (/^Title:/i.test(text)) {
        secondaryTitle = text.replace(/^Title:\s*/i, '').trim();
        return;
      }

      // =============================
      // Author
      // =============================
      if (/^Written by:/i.test(text)) {
        let raw = text.replace(/^Written by:\s*/i, '').trim();

        // Remove brackets: 小小牧童 (Xiao Xiao Mutong) -> 小小牧童
        raw = raw.replace(/\(.*?\)/g, '').trim();
        author = raw;
        return;
      }

      // =============================
      // Genres
      // =============================
      if (/^Category:/i.test(text)) {
        genres = text.replace(/^Category:\s*/i, '').trim();
        return;
      }

      // =============================
      // Status
      // =============================
      if (/^Status:/i.test(text)) {
        const t = text.toLowerCase();
        if (t.includes('complete') || t.includes('completed')) {
          status = NovelStatus.Completed;
        } else if (t.includes('ongoing')) {
          status = NovelStatus.Ongoing;
        }
        return;
      }
    });

    // If blockquote exists → summary comes from blockquote
    let summary = '';
    if (blockquoteSummary) {
      summary = blockquoteSummary;
    } else if (descriptionParts.length > 0) {
      summary = descriptionParts.join('<br>\n\n').trim();
    }

    // If h5 exists → author comes from h5
    let authorName = '';
    if (h5Author) {
      authorName = h5Author;
    } else {
      authorName = author;
    }

    // ======================================================
    // 5) FINAL COMBINED TITLE
    // ======================================================
    const name = secondaryTitle
      ? `${mainTitle} / ${secondaryTitle}`
      : mainTitle;

    // ======================================================
    // 6) CHAPTERS
    // ======================================================
    const chapters: Plugin.ChapterItem[] = [];

    $content.find('ul.wp-block-list li').each((_i, liEl) => {
      const $li = $(liEl);
      const links = $li.find('a');

      // Create a fully cleaned <li>: remove ALL tags, keep only text
      const clean = $li.clone();
      clean.find('*').remove();
      const fullText = clean.text().trim();

      // ----------------------------------------
      // CASE 1: No links → chapter name only
      // ----------------------------------------
      if (links.length === 0) {
        if (fullText) {
          chapters.push({
            name: fullText,
            path: '',
          });
        }
        return;
      }

      // ----------------------------------------
      // CASE 2: One <a> → simple chapter
      // ----------------------------------------
      if (links.length === 1) {
        const $a = links.first();
        chapters.push({
          name: fullText,
          path: makeAbsolute($a.attr('href') || '', this.site) || '',
        });
        return;
      }
      // ----------------------------------------
      // CASE 3: Multiple <a> → base title + parts
      // ----------------------------------------

      // Full text of the <li>
      const fullChapterText = $li.text().trim();

      // Text of first <a>
      const firstLinkText = $li.find('a').first().text().trim();

      // Split at the first link text (safe even if not unique)
      const baseName = fullChapterText.split(firstLinkText)[0].trim();

      // 4) For each <a>, create its full part title
      links.each((_j, aEl) => {
        const $a = $(aEl);

        // Text of the part link: "Part 1", "Part 2"
        const partName = $a.text().trim();

        // Full chapter name:
        const fullName = `${baseName}. ${partName}`;

        chapters.push({
          name: fullName,
          path: makeAbsolute($a.attr('href') || '', this.site) || '',
        });
      });
    });

    // ======================================================
    // 7) RETURN RESULT
    // ======================================================
    return {
      path: novelPath,
      name,
      cover,
      author: authorName,
      summary,
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

    // =========================
    // 1) Get chapter title
    // =========================
    const $article = $('main#main article').first();
    const title =
      $article
        .find('header.entry-header h1.entry-title')
        .first()
        .text()
        .trim() || 'Chapter';

    // =========================
    // 2) Get chapter dates
    // =========================
    const $timePublished = $article.find(
      'header.entry-header div.entry-meta span.posted-on a time.entry-date.published',
    );

    let dateText = '';
    if ($timePublished.length) {
      dateText = `<p><i>${$timePublished.text().trim()}</i></p>`;
    }

    // =========================
    // 3) Chapter content
    // =========================
    const $content = $article.find('div.entry-content').first();

    // Remove sharing block
    $content.find('div.sharedaddy.sd-sharing-enabled').remove();

    // Remove comments
    $content.contents().each((_i, node) => {
      if (node.type === 'comment') $(node).remove();
    });

    // Get inner HTML as-is (includes <p> and <hr>)
    const contentHtml = $content.html()?.trim() || '';

    // =========================
    // 4) Build final HTML
    // =========================
    const finalHtml = `<h1>${title}</h1><br>\n${dateText ? dateText + '\n' : ''}🐼<br>\n${contentHtml}`;

    return finalHtml;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    return [];
  }
}

export default new aihristdreamPlugin();

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
