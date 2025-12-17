import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class betwixtedbutterflyPlugin implements Plugin.PluginBase {
  id = 'betwixtedbutterfly';
  name = 'Betwixted Translations';
  site = 'https://betwixtedbutterfly.com/translations/';
  version = '1.0.0';
  icon = 'src/en/betwixtedbutterfly/favicon.png';

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return []; // Only one page of projects

    const url = this.site;
    const res = await fetchApi(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch homepage: ${res.status}`);
    }

    const $ = parseHTML(await res.text());

    const novels: Plugin.NovelItem[] = [];

    // Find the "Projects" top-level menu item
    const $projectsItem = $('#menu-header-1 > li > a')
      .filter((_, el) => $(el).text().trim() === 'Projects')
      .parent('li');

    if ($projectsItem.length === 0) {
      // Fallback warning if structure changes
      console.warn('Could not find "Projects" menu item');
      return novels;
    }

    // Get its direct sub-menu and find all <a> that link to novels
    // We target top-level links inside the sub-menu (both flat projects and parent dropdowns)
    // while skipping deeper sub-sub-menu items (e.g., Characters, Schedule)
    $projectsItem.find('> ul.sub-menu > li > a').each((_, el) => {
      const $a = $(el);

      let href = $a.attr('href');
      if (!href) return;

      const title = $a.text().trim();

      // Make absolute and extract the relative path
      href = makeAbsolute(href, this.site) || '';

      novels.push({
        name: title,
        path: href,
        cover: defaultCover, // No covers available on the site
      });
    });

    return novels;
  }
  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = novelPath;
    const res = await fetchApi(url);
    if (!res.ok) {
      throw new Error(`Failed to load novel page: ${res.status}`);
    }

    const $ = parseHTML(await res.text());

    // --- Title ---
    const rawTitle = $('h2.elementor-heading-title').text().trim(); // Pattern: "English Title (Original Title)"
    // We want to reformat to "English Title / Original Title" if original is present in ()
    const match = rawTitle.match(/^([^(\[]+)\s*[\(\[]([^)\]]+)[\)\]]$/);
    let title = 'Untitled';
    if (match) {
      const english = match[1].trim();
      const original = match[2].trim();
      title = `${english} / ${original}`;
    } else {
      // Fallback: if no parentheses/brackets, or unusual format, use as-is
      title = rawTitle;
    }

    // --- Cover Image ---
    // Look for the first meaningful image near the top (often in early <p>)
    const $cover = $('div.elementor-widget-container > img');
    const cover = makeAbsolute($cover.attr('src'), this.site) || defaultCover;

    let author = '';
    let status = '';
    // --- Metadata: Author and Status ---
    $('div.elementor-widget-container p').each((_, p) => {
      const text = $(p).text().trim();

      // Author
      if (text.startsWith('Author:')) {
        let authorText = text.replace('Author:', '').trim();
        const bracketMatch = authorText.match(/\(([^)]+)\)/);
        if (bracketMatch) {
          author = bracketMatch[1].trim();
        } else {
          author = authorText;
        }
      }

      // Status (original or translation)
      if (
        text.startsWith('Status:') ||
        text.startsWith('Status in the country of origin:')
      ) {
        const statusText = text.toLowerCase();
        if (
          statusText.includes('complete') ||
          statusText.includes('completed')
        ) {
          status = NovelStatus.Completed;
        } else if (statusText.includes('ongoing')) {
          status = NovelStatus.Ongoing;
        } else {
          status = NovelStatus.Unknown;
        }
      }
    });

    // --- Genres/Tags ---
    const genres: string[] = [];
    $('div.elementor-widget-container a.elementor-button').each((_, a) => {
      const tag = $(a).find('.elementor-button-text').text().trim();
      if (tag) {
        genres.push(tag);
      }
    });
    const genre = genres.join(', ');

    // --- Summary ---
    let summaryBuilder = '';
    let inSummary = false;
    $('div.elementor-widget-container').each((_, div) => {
      const $div = $(div);

      // Detect start: h3 with "Summary"
      if (
        $div.find('h3.elementor-heading-title').text().trim().toLowerCase() ===
        'summary'
      ) {
        inSummary = true;
        return; // skip the heading itself
      }

      // Detect end: h3 with "Table of Contents"
      if (
        inSummary &&
        $div.find('h3.elementor-heading-title').text().trim().toLowerCase() ===
          'table of contents'
      ) {
        inSummary = false;
        return false; // stop looping
      }

      if (inSummary) {
        // Collect text from p, or alert description
        const pText = $div.find('p').text().trim();
        if (pText) {
          summaryBuilder += pText + '\n\n';
        }

        const alertTitle = $div.find('.elementor-alert-title').text().trim();
        const alertDesc = $div
          .find('.elementor-alert-description')
          .text()
          .trim();
        if (alertTitle || alertDesc) {
          summaryBuilder += `${alertTitle ? alertTitle + '\n' : ''}${alertDesc}\n\n`;
        }
      }
    });
    const summary = summaryBuilder.trim();

    // --- Chapters ---
    let chapters: Plugin.ChapterItem[] = [];
    $('div.elementor-toggle-item .elementor-tab-content a').each((i, a) => {
      const $a = $(a);
      const name = $a.text().trim();
      let href = $a.attr('href');
      if (!name || !href) return;

      href = makeAbsolute(href, this.site) || '';

      // Extract chapterNumber, e.g., from "Chapter 001" -> 1
      const numMatch = name.match(/Chapter\s*(\d+)/i);
      const chapterNumber = numMatch ? parseInt(numMatch[1], 10) : i + 1;

      chapters.push({
        name,
        path: href,
        chapterNumber,
      });
    });

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: title,
      cover: cover,
      status,
      author,
      genres: genre,
      summary,
      chapters: chapters,
    };

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = chapterPath;
    const res = await fetchApi(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch chapter: ${res.status}`);
    }

    const $ = parseHTML(await res.text());

    let releaseDate = $('span.published').text().trim();

    let $content = $('div.entry-inner');
    let isElementor = false;

    // Case 1: Elementor structure (most chapters)
    const $elementor = $('div.entry-inner .elementor').first();
    if ($elementor.length > 0) {
      isElementor = true;
      $content = $elementor;
    } else {
      // Case 2: Clean/classic WordPress structure
      if ($content.length === 0) {
        throw new Error('Could not find chapter content container');
      }
    }

    // --- Chapter Title ---
    let title = $content.find('h2').first().text().trim() || '';

    // --- Remove unwanted navigation elements ---
    // Elementor navigation sections (Next/Project buttons)
    $content.find('section.elementor-section').each((_, sec) => {
      const $sec = $(sec);
      const btnText = $sec.find('.elementor-button-text').text().toLowerCase();
      if (
        btnText.includes('next') ||
        btnText.includes('project') ||
        btnText.includes('previous')
      ) {
        $sec.remove();
      }
    });

    // Classic WP navigation: columns with TOC / next chapter links
    $content.find('div.wp-block-columns').each((_, col) => {
      const $col = $(col);
      if (
        $col.find('a').text().toLowerCase().includes('table of contents') ||
        $col.find('a').text().includes('>>') ||
        $col.find('a').text().includes('<<')
      ) {
        $col.remove();
      }
    });

    // Pagination nav
    $content.find('nav.pagination').remove();

    // --- Build cleaned content ---
    const cleanedBlocks: string[] = [];

    // Helper: processes a single container (either .elementor-widget-container or the root for classic)
    const processWidget = ($widget: any) => {
      // Handle special elements first (images, footnotes, dividers, notes)
      console.log('Proceed element');
      if ($widget.is('.wp-block-image')) {
        console.log('------- image');
        const $img = $widget.find('img').first();
        if ($img.length) {
          const src = $img.attr('src') || '';
          const alt = $img.attr('alt') || '';
          if (src) cleanedBlocks.push(`<p><img src="${src}" alt="${alt}"></p>`);
          console.log(`<p><img src="${src}" alt="${alt}"></p>`);
        }
        return;
      }

      if ($widget.attr('id')?.startsWith('sdfootnote')) {
        console.log('------- footnote');
        const text = $widget.text().trim();
        const numMatch = text.match(/^(\d+|[a-zA-Z]+)/);
        if (numMatch) {
          const anchor = numMatch[0];
          const rest = text
            .slice(anchor.length)
            .trim()
            .replace(/^[:.\s]+/, '');
          cleanedBlocks.push(`<p><b>${anchor}: </b>${rest}</p>`);
          console.log(`<p><b>${anchor}: </b>${rest}</p>`);
        } else {
          cleanedBlocks.push(`<p><b>${text}</b></p>`);
          console.log(`<p><b>${text}</b></p>`);
        }
        return;
      }

      if (
        $widget.find('.elementor-divider-separator').length > 0 ||
        $widget.is('.elementor-divider')
      ) {
        console.log('------- hr');
        cleanedBlocks.push('<hr>');
        return;
      }

      if ($widget.is('h5')) {
        console.log('------- h5');
        cleanedBlocks.push('<h2>' + $widget.html() + '</h2>');
        return;
      }

      if ($widget.is('h3') && $widget.text().trim().endsWith(':')) {
        console.log('------- notes');
        cleanedBlocks.push('<hr>');
        cleanedBlocks.push('<h3>' + $widget.text().trim() + '</h3>');
        return;
      }

      // Main text: extract all <p> inside this widget
      if ($widget.is('p')) {
        console.log('------- p');

        // Clone the <p> so we can safely modify it
        const $p = $widget.clone();

        // Clean it: remove links and unwrap styled spans
        $p.find('a').remove();
        $p.find('span[style*="font-weight"], span[style*="color"]')
          .contents()
          .unwrap();

        const html = $p.html()?.trim();
        if (html) {
          cleanedBlocks.push('<p>' + html + '</p>');
        }
        return;
      }

      // If no <p>, fallback to direct text in widget
      if ($widget.text().trim()) {
        console.log('----- Something else');
        const html = $widget.clone().find('a').remove().end().html()?.trim();
        if (html) cleanedBlocks.push('<p>' + html + '</p>');
      }
    };

    // Now apply the function to all direct children
    if (isElementor) {
      // Elementor: process each section's widget containers
      $content.find('.elementor-widget-container').each((_, el) => {
        const $section = $(el);
        $section.children().each((_, widgetEl) => {
          processWidget($(widgetEl));
        });
      });
    } else {
      // Classic: process the root directly (its children are p, hr, etc.)
      $content.children().each((_, el) => {
        processWidget($(el));
      });
    }

    // --- Final HTML ---
    const chapterHtml = `<h1>${title}</h1><hr><p><i>${releaseDate}</i></p>
      ${cleanedBlocks.join('\n')}`.trim();

    return chapterHtml;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    return [];
  }
}

export default new betwixtedbutterflyPlugin();

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
