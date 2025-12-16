import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class snoutandcoPlugin implements Plugin.PluginBase {
  id = 'snoutandco';
  name = 'Snout and co';
  site = 'https://snoutandco.ca/';
  version = '11.0.0';
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
    // ============================================================
    // 1) LOAD index.html AND FIND THE MATCHING <a href="...">
    // ============================================================

    const indexUrl = this.site + 'index.html';
    console.log('Parsing novel:', indexUrl);
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

    console.log('Parsing chapters via API:', novelPath);

    // 1️⃣ Extract folder from novelPath
    const urlObj = new URL(novelPath);
    const folder = urlObj.searchParams.get('folder');
    if (!folder) throw new Error('Folder not found in novelPath: ' + novelPath);
    console.log('Detected folder:', folder);

    // 2️⃣ Fetch chapters JSON
    const chaptersJsonUrl = `${this.site}${folder}/chapters.json`;
    console.log('Fetching chapters JSON:', chaptersJsonUrl);

    const chaptersRes = await fetchApi(chaptersJsonUrl);
    if (!chaptersRes.ok)
      throw new Error('Failed to fetch chapters.json: ' + chaptersJsonUrl);

    const chaptersData = await chaptersRes.json();
    if (!chaptersData.chapters || !Array.isArray(chaptersData.chapters)) {
      throw new Error('Invalid chapters.json structure');
    }

    // 3️⃣ Build chapter list
    const chapters: Plugin.ChapterItem[] = chaptersData.chapters.map(
      (c: any) => ({
        name: c.title || `Chapter ${c.filename}`,
        path: `${this.site}${folder}/chapters/${c.filename}`,
      }),
    );
    console.log(`Total chapters found: ${chapters.length}`);

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
    console.log('Parsing chapter from URL:', chapterPath);
    const chapterUrl = makeAbsolute(chapterPath, this.site);
    if (!chapterUrl) throw new Error('Invalid chapter URL');

    const res = await fetchApi(chapterUrl);
    if (!res.ok) throw new Error('Failed to fetch chapter');

    // Get plain text of chapter
    const text = await res.text();
    if (!text || !text.trim()) return 'Error: Chapter content is empty';

    // Wrap each line (or paragraph) in <p>
    // Split by double newlines or single newlines
    const paragraphs = text
      .split(/\r?\n\r?\n|\r?\n/) // split by empty line or newline
      .map(p => p.trim())
      .filter(p => p.length > 0) // remove empty lines
      .map(p => `<p>${p}</p>`); // wrap in <p>

    // Add chapter title at the top
    const title = `<h1>${chapterPath.split('/').pop()?.replace('.txt', '') || ''}</h1>`;

    return title + '🐼<br>\n' + paragraphs.join('\n');
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
