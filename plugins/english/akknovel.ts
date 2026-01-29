import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class akkNovelPlugin implements Plugin.PluginBase {
  id = 'akknovel';
  name = 'AKK Novel';
  icon = 'src/en/akknovel/favicon.png'; // change path if needed
  site = 'https://www.akknovel.com/';
  version = '2.0.0';

  // Optional: if you later want to add filters (genre, status, etc.)
  // filters = { ... }
  private normalizeChapterName(raw: string): string {
    raw = raw.trim();

    // ───────────────────────────────────────────────────────────────
    //  Helper to pad only the integer part (supports decimals like 9.5)
    // ───────────────────────────────────────────────────────────────
    const padNumber = (numStr: string): string => {
      const [int, dec = ''] = numStr.split('.');
      const paddedInt = int.padStart(5, '0');
      return dec ? `${paddedInt}.${dec}` : paddedInt;
    };

    // ───────────────────────────────────────────────────────────────
    //  Pattern 1: Ch.123Title, Ch. 45: Title, Ch45 - Extra, ch.9.5
    // ───────────────────────────────────────────────────────────────
    const match1 = raw.match(/^Ch\.?\s*(\d+(?:\.\d+)?)(.*)$/i);
    if (match1) {
      const numStr = match1[1];
      let rest = match1[2].trim();

      // Clean up common separators at start of rest
      rest = rest.replace(/^[:.\-\s]+/, '').trim();

      const padded = padNumber(numStr);
      return rest ? `Chapter ${padded} ${rest}` : `Chapter ${padded}`;
    }

    // ───────────────────────────────────────────────────────────────
    //  Pattern 2: Chapter 123, Chapter 45 Title, Chapter 9.5 - Extra
    // ───────────────────────────────────────────────────────────────
    const match2 = raw.match(/^Chapter\s+(\d+(?:\.\d+)?)(.*)$/i);
    if (match2) {
      const numStr = match2[1];
      let rest = match2[2].trim();

      rest = rest.replace(/^[:.\-\s]+/, '').trim();

      const padded = padNumber(numStr);
      return rest ? `Chapter ${padded} ${rest}` : `Chapter ${padded}`;
    }

    // ───────────────────────────────────────────────────────────────
    //  Pattern 3: Ep.12, Episode 8 Title (optional fallback)
    // ───────────────────────────────────────────────────────────────
    const match3 = raw.match(/^(?:Ep(?:isode)?\.?)\s*(\d+(?:\.\d+)?)(.*)$/i);
    if (match3) {
      const numStr = match3[1];
      let rest = match3[2].trim();

      rest = rest.replace(/^[:.\-\s]+/, '').trim();

      const padded = padNumber(numStr);
      return rest ? `Chapter ${padded} ${rest}` : `Chapter ${padded}`;
    }

    // ───────────────────────────────────────────────────────────────
    //  Fallback: try to fix obvious "Ch 123" or "ch.123" → "Chapter 00123"
    // ───────────────────────────────────────────────────────────────
    const fallbackMatch = raw.match(/^ch\.?\s*(\d+(?:\.\d+)?)(.*)$/i);
    if (fallbackMatch) {
      const numStr = fallbackMatch[1];
      let rest = fallbackMatch[2].trim();

      rest = rest.replace(/^[:.\-\s]+/, '').trim();

      const padded = padNumber(numStr);
      return rest ? `Chapter ${padded} ${rest}` : `Chapter ${padded}`;
    }

    // Ultimate fallback — just return original (or you can add more logic)
    return raw;
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    const url = `${this.site}series/page/${pageNo}?sort=updatedAt`;
    const novels: Plugin.NovelItem[] = [];

    const res = await fetchApi(url);
    if (!res.ok) return novels;

    const $ = parseHTML(await res.text());

    $('article.items-start').each((_i, el) => {
      const $el = $(el);

      // Title & path
      const $titleA = $el.find('h2').parent('a');
      const novelPath = $titleA.attr('href')?.trim() || '';
      const name = $titleA.find('h2').text().trim();

      // Cover
      const cover =
        $el.find('img').first().attr('src') ||
        $el.find('img').first().attr('data-src') ||
        defaultCover;

      if (name && novelPath) {
        novels.push({
          name,
          path: novelPath,
          cover: makeAbsolute(cover, this.site) || defaultCover,
        });
      }
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = makeAbsolute(novelPath, this.site);
    if (!url) throw new Error('Invalid novel path');

    const res = await fetchApi(url);
    if (!res.ok) throw new Error(`Failed to fetch novel: ${res.status}`);

    const $ = parseHTML(await res.text());

    // Title
    const name = $('h1').first().text().trim() || 'Untitled';

    // Cover
    const cover =
      $('img.object-cover').first().attr('src') ||
      $('img.object-cover').first().attr('data-src') ||
      defaultCover;

    // Status (from badge)
    let status = '';
    status = NovelStatus.Unknown;
    const badgeText = $('div.badge').first().text().trim().toLowerCase();
    if (badgeText.includes('going')) status = NovelStatus.Ongoing;
    else if (badgeText.includes('complete') || badgeText.includes('ended'))
      status = NovelStatus.Completed;
    else if (badgeText.includes('hiatus')) status = NovelStatus.OnHiatus;
    else if (badgeText.includes('drop') || badgeText.includes('cancel'))
      status = NovelStatus.Cancelled;

    // Summary
    let summary = '';
    $('#intro div.leading-7')
      .contents()
      .each((_i, node) => {
        if (node.type === 'text') {
          const t = $(node).text().trim();
          if (t) summary += t + ' ';
        } else if (
          node.type === 'tag' &&
          (node.tagName === 'br' || node.tagName === 'p')
        ) {
          summary = summary.trim() + '\n\n';
        }
      });
    summary = summary.trim().replace(/\n{3,}/g, '\n\n');

    // Chapters
    const chapters: Plugin.ChapterItem[] = [];

    $('#chapters div.chapter-item a').each((_i, el) => {
      const $a = $(el);
      const chapterPath = $a.attr('href')?.trim() || '';

      // Build chapter name
      let rawName = $a.text().trim();
      const chapterName = this.normalizeChapterName(rawName);

      if (chapterPath && chapterName) {
        chapters.push({
          name: chapterName,
          path: chapterPath,
          releaseTime: undefined, // can try to parse later if date appears
        });
      }
    });

    return {
      path: novelPath,
      name,
      cover: makeAbsolute(cover, this.site) || defaultCover,
      summary,
      status,
      chapters,
      author: undefined, // not extracted yet — add selector if visible
      genres: undefined, // same
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = makeAbsolute(chapterPath, this.site);
    if (!url) throw new Error('Invalid chapter path');

    const res = await fetchApi(url);
    if (!res.ok) throw new Error(`Failed to fetch chapter: ${res.status}`);

    const $ = parseHTML(await res.text());

    // Chapter title
    const title = $('#content-box h1').first().text().trim() || 'Chapter';

    // Content
    const $content = $('article#chapter-content');

    // Remove unwanted elements
    $content.find('script, ins, style, iframe').remove();

    // Get clean paragraphs
    let html = $content
      .find('p')
      .map((_i, p) => {
        // Keep inner HTML but remove attributes from <p>
        const inner = $(p).html()?.trim() || '';
        return inner ? `<p>${inner}</p>` : '';
      })
      .get()
      .filter(Boolean)
      .join('\n');

    if (!html.trim()) {
      // Fallback: take all text if structure is broken
      html = $content
        .text()
        .trim()
        .replace(/\n{3,}/g, '\n\n');
      html = `<p>${html.replace(/\n/g, '<br>')}</p>`;
    }

    // Final result
    return `<h1>${title}</h1>\n🐼<br>\n${html}`;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const keyword = encodeURIComponent(searchTerm.trim());
    const url = `${this.site}series/page/${pageNo}?keyword=${keyword}`;

    const res = await fetchApi(url);
    if (!res.ok) return [];

    const $ = parseHTML(await res.text());
    const novels: Plugin.NovelItem[] = [];

    $('article.items-start').each((_i, el) => {
      const $el = $(el);

      const $titleA = $el.find('h2').parent('a');
      const novelPath = $titleA.attr('href')?.trim() || '';
      const name = $titleA.find('h2').text().trim();

      const cover =
        $el.find('img').first().attr('src') ||
        $el.find('img').first().attr('data-src') ||
        defaultCover;

      if (name && novelPath) {
        novels.push({
          name,
          path: novelPath,
          cover: makeAbsolute(cover, this.site) || defaultCover,
        });
      }
    });

    return novels;
  }
}

export default new akkNovelPlugin();

// ───────────────────────────────────────────────
//  Helper (already present in many of your plugins)
// ───────────────────────────────────────────────
const makeAbsolute = (
  relative: string | undefined,
  base: string,
): string | undefined => {
  if (!relative) return undefined;
  try {
    if (relative.startsWith('//')) return new URL(base).protocol + relative;
    if (relative.startsWith('http://') || relative.startsWith('https://'))
      return relative;

    const baseClean = base.endsWith('/') ? base.slice(0, -1) : base;
    const relClean = relative.startsWith('/') ? relative.slice(1) : relative;

    return new URL(relClean, baseClean + '/').href;
  } catch {
    return undefined;
  }
};
