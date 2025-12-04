import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class snoutandcoPlugin implements Plugin.PluginBase {
  id = 'snoutandco';
  name = 'Snout and co';
  site = 'https://snoutandco.ca/';
  version = '1.0.0';
  icon = 'src/en/snoutandco/favicon.png';

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];
    const url = `${this.site}index.html`;
    console.log('Fetching home page URL:', url);
    const res = await fetchApi(url);
    if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

    const $ = parseHTML(await res.text());

    const novels: Plugin.NovelItem[] = [];

    $('div.card').each((_i, cardEl) => {
      const $card = $(cardEl);
      const $a = $card.find('a').first();
      const path = makeAbsolute($a.attr('href'), this.site) || '';
      const $img = $a.find('img').first();
      const cover = makeAbsolute($img.attr('src'), this.site) || defaultCover;
      const $cardbody = $a.find('div.card-body').first();
      const rawTitle =
        $cardbody.find('h3.card-title').first().text().trim() || 'Unknown';
      const match = rawTitle.match(/^([\s\S]*)\(([\s\S]*)\)$/);
      let finalTitle: string;
      if (match) {
        // Clean English part: collapse newlines/spaces → single spaces
        const english = match[1].replace(/\s+/g, ' ').trim();
        // Original: just trim
        const original = match[2].trim();
        finalTitle = `${english} / ${original}`;
      } else {
        finalTitle = rawTitle;
      }
      novels.push({
        name: finalTitle,
        path: path,
        cover: cover,
      });
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    console.log('Parsing novel:', novelPath);

    // ============================================================
    // 1) LOAD index.html AND FIND THE MATCHING <a href="...">
    // ============================================================

    const indexUrl = this.site + 'index.html';
    const indexRes = await fetchApi(indexUrl);
    if (!indexRes.ok) throw new Error('Failed to load index.html');

    const indexHtml = await indexRes.text();
    const $ = parseHTML(indexHtml);

    // Normalize URLs for comparison
    const target = novelPath.toLowerCase();

    // Find matching <a href="...">
    let matchedA = $('h1');

    $('div.card a').each((_i, el) => {
      const href = $(el).attr('href');
      if (!href) return;

      const abs = makeAbsolute(href, this.site)?.toLowerCase();
      if (abs && abs === target) matchedA = $(el);
    });

    if (!matchedA) throw new Error('Novel not found in index.html');

    // ============================================================
    // 2) PARSE NOVEL INFO FROM THE MATCHED CARD
    // ============================================================

    // --- COVER ---
    const cover =
      makeAbsolute(matchedA.find('img').attr('src'), this.site) || defaultCover;

    // --- TITLE ---
    const rawTitle =
      matchedA.find('h3.card-title').first().text().trim() || 'Untitled';
    let name = rawTitle;

    const titleMatch = rawTitle.match(/^([\s\S]*)\(([\s\S]*)\)$/);
    if (titleMatch) {
      const english = titleMatch[1].replace(/\s+/g, ' ').trim();
      const original = titleMatch[2].trim();
      name = `${english} / ${original}`;
    }

    // --- TEXT BLOCK ---
    const textBlock = matchedA
      .find('p.card-text')
      .text()
      .trim()
      .replace(/\s+/g, ' ');

    // --- AUTHOR: extract Chinese part only ---
    let author = 'Unknown';
    const authorMatch = textBlock.match(/Author:\s*.*?\((.*?)\)/);
    if (authorMatch) author = authorMatch[1].trim();

    // --- SUMMARY (Genre line) ---
    let summary = '';
    const genreMatch = textBlock.match(/Genre:\s*(.*?)(?:<|$)/i);
    if (genreMatch) summary = genreMatch[1].trim();

    // --- STATUS (Translation: ...) ---
    let statusText = '';
    const statusMatch = textBlock.match(/Translation:\s*(.*)/i);
    if (statusMatch) statusText = statusMatch[1].trim().toUpperCase();

    let status;
    if (statusText.includes('COMPLETED')) status = NovelStatus.Completed;
    else status = NovelStatus.Unknown;

    // ============================================================
    // 3) FETCH CHAPTER LIST FROM API USING novelTag
    // ============================================================

    console.log('Parsing chapters:', novelPath);

    const chapterRes = await fetchApi(novelPath);
    if (!chapterRes.ok)
      throw new Error('Failed to load novel page: ' + novelPath);

    const chapterHtml = await chapterRes.text();
    const $c = parseHTML(chapterHtml);

    // Select the UL that contains chapters
    const $chaptersList = $c('ul#chapter-list');

    const chapters: Plugin.ChapterItem[] = [];

    // Today's date in yyyy-mm-dd
    const today = new Date().toISOString().split('T')[0];

    // Loop through all LI elements inside the chapter list
    $chaptersList.find('li').each((_i, li) => {
      const $li = $c(li);
      const $a = $li.find('a');

      if ($a.length === 0) return; // No link → skip

      // Extract chapter path
      const chapterPath = $a.attr('href')?.trim() || '';

      // Extract visible chapter title
      const chapterTitle = $a.text().trim();

      // Push result into chapters list
      chapters.push({
        name: chapterTitle,
        releaseTime: today,
        path: chapterPath,
      });
    });

    // ============================================================
    // 4) RETURN MERGED RESULT
    // ============================================================

    return {
      path: novelPath,
      name,
      cover,
      author,
      summary,
      genres: '',
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

    const title = `<h1>${$('h1#chapter-title').first().text().trim() || ''}</h1>`;

    // === Target the main content container ===
    const $content = $('pre#chapter-content');
    if (!$content.length) return 'Error: Could not find chapter content';

    let chapterText = $content.html() || 'Error: Chapter content is empty';

    chapterText = title + '🐼<br>' + chapterText;

    return chapterText.trim();
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    return [];
  }
}

export default new snoutandcoPlugin();

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
