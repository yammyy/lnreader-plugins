import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { storage } from '@libs/storage';

class DragonholicTranslationsPlugin implements Plugin.PluginBase {
  id = 'dragonholictranslations';
  name = 'Dragonholic Translations';
  site = 'https://dragonholictranslations.com/';
  apisite = this.site + 'wp-json/wp/v2/';
  version = '1.1.1';
  icon = 'src/en/dragonholic/favicon.png';

  hideLocked = storage.get('hideLocked') ?? false;
  pluginSettings = {
    hideLocked: {
      value: '',
      label: 'Hide premium/locked chapters',
      type: 'Switch',
    },
  };

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    const pagePath = pageNo > 1 ? `page/${pageNo}/` : '';
    const url = `${this.site}browse/${pagePath}?sort=trending&order=desc&status=all`;

    const res = await fetchApi(url);
    if (!res.ok) return [];

    const html = await res.text();
    const $ = parseHTML(html);

    const novels: Plugin.NovelItem[] = [];

    // Main container → grid → direct <a class="group flex"> children
    $('#series-list-container a.group.flex').each((_i, el) => {
      const $a = $(el);

      const path = makeAbsolute($a.attr('href'), this.site);
      if (!path) return;

      // Title from h3 inside the card
      const $h3 = $a.find('h3');
      const name = $h3.text().trim();
      if (!name) return;

      // Cover image
      let cover = defaultCover;
      const $img = $a.find('img');
      if ($img.length) {
        cover = $img.attr('src') || $img.attr('data-src') || defaultCover;
      }

      novels.push({
        name,
        path,
        cover,
      });
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    // Step 1: Get slug from path
    const slug = novelPath.split('/').filter(Boolean).pop();
    if (!slug) throw new Error('Invalid novel path');

    // Step 2: Fetch series JSON to get real ID
    const seriesApiUrl = `${this.apisite}series?slug=${slug}&_embed`;
    const seriesRes = await fetchApi(seriesApiUrl);
    if (!seriesRes.ok) throw new Error('Failed to fetch series metadata');

    const seriesArray = await seriesRes.json();
    if (!Array.isArray(seriesArray) || seriesArray.length === 0) {
      throw new Error('Series not found');
    }

    const json = seriesArray[0];
    const seriesId = json.id;
    if (!seriesId) throw new Error('Series ID not found in API response');

    const title = json.title?.rendered?.trim() || 'Untitled';

    let summary = '';
    if (json.content?.rendered) {
      const $sum = parseHTML(json.content.rendered);
      $sum('script, style').remove();
      summary = $sum.text().trim().replace(/\s+/g, ' ');
    }

    let cover = defaultCover;
    // Prefer featured media if available
    if (json._embedded?.['wp:featuredmedia']?.[0]?.source_url) {
      cover = json._embedded['wp:featuredmedia'][0].source_url;
    }

    const STATUS_MAP: Record<number, string> = {
      5486: NovelStatus.Ongoing,
      876: NovelStatus.Ongoing, // duplicate
      5487: NovelStatus.Completed,
      5488: NovelStatus.Cancelled,
      5489: NovelStatus.Cancelled, // or OnHiatus
      5490: NovelStatus.OnHiatus,
    };
    const statusIds = json['story-status'] || [];
    const firstStatusId = statusIds.length > 0 ? Number(statusIds[0]) : null;
    const status =
      firstStatusId && STATUS_MAP[firstStatusId]
        ? STATUS_MAP[firstStatusId]
        : NovelStatus.Unknown;

    // Genres
    const GENRE_MAP: Record<number, string> = {
      2: 'Action',
      3: 'Mature',
      4: 'Adventure',
      389: 'BL',
      6: 'Comedy',
      10: 'Drama',
      11: 'Ecchi',
      12: 'Fantasy',
      390: 'Harem',
      391: 'Historical',
      392: 'Horror',
      393: 'Josei',
      22: 'Martial Arts',
      23: 'Mature',
      24: 'Mecha',
      25: 'Mystery',
      27: 'Psychological',
      394: 'Reincarnation',
      28: 'Romance',
      29: 'School Life',
      30: 'Sci-fi',
      31: 'Seinen',
      32: 'Shoujo',
      33: 'Shoujo Ai',
      36: 'Slice of Life',
      37: 'Smut',
      40: 'Sports',
      41: 'Supernatural',
      42: 'Tragedy',
      43: 'Webtoon',
      395: 'Xianxia',
      44: 'Yaoi',
      45: 'Yuri',
    };
    // Parse genres
    const genreIds = json.genre || []; // array of numbers, e.g. [3, 6, 10, 12, 392, 393, 23, 25, 28, 41, 43]
    const uniqueGenres = new Set<string>();
    genreIds.forEach((id: number | string) => {
      const genreId = Number(id);
      if (!isNaN(genreId)) {
        const name = GENRE_MAP[genreId];
        if (name) {
          uniqueGenres.add(name);
        }
      }
    });
    const genres = Array.from(uniqueGenres).sort().join(', ');

    // ────────────────────────────────
    // Author — separate request
    // ────────────────────────────────
    let author: string | undefined = undefined;
    const authorApiUrl = `${this.apisite}series-author?post=${seriesId}`;
    const authorRes = await fetchApi(authorApiUrl);
    if (authorRes.ok) {
      const authorArray = await authorRes.json();
      if (Array.isArray(authorArray) && authorArray.length > 0) {
        // Collect all names, join with ", " if multiple
        const names = authorArray
          .map((item: any) => item.name?.trim())
          .filter(Boolean);
        if (names.length > 0) {
          author = names.join(', ');
        }
      }
    }

    // Step 3: Fetch chapters
    // ────────────────────────────────
    // Chapters — two-step fetch
    // ────────────────────────────────
    const chapters: Plugin.ChapterItem[] = [];
    // 1. Get totalChapters (using small per_page)
    const probeUrl = `${this.site}api/chapters?series_id=${seriesId}&sort_order=asc&per_page=1`;
    const probeRes = await fetchApi(probeUrl);
    let totalChapters = 0;
    if (probeRes.ok) {
      const probeJson = await probeRes.json();
      totalChapters = Number(probeJson.totalChapters) || 0;
    }
    if (totalChapters > 0) {
      // 2. Fetch all chapters in one request
      const chaptersUrl = `${this.site}api/chapters?series_id=${seriesId}&sort_order=asc&per_page=${totalChapters}`;
      const chapRes = await fetchApi(chaptersUrl);
      if (chapRes.ok) {
        const chapJson = await chapRes.json();
        if (chapJson.success && Array.isArray(chapJson.chapters)) {
          chapJson.chapters.forEach((ch: any) => {
            if (ch.is_premium && this.hideLocked) return;
            // Prefix for premium
            let prefix = '';
            if (ch.is_premium) {
              prefix = ch.free_schedule !== null ? '💎 ' : '❌ ';
            }
            // Volume prefix (if exists)
            let volumePart = '';
            if (ch.volume_id !== null && ch.volume_id !== undefined) {
              volumePart = `Volume ${String(ch.volume_id).padStart(5, '0')} - `;
            }
            // Chapter title formatting
            const chapterNumber = String(ch.chapter_order || '').padStart(
              5,
              '0',
            );
            const mainTitle = ch.heading || ch.name;
            const subtitlePart = ch.subtitle ? ` ${ch.subtitle}` : '';
            const chName =
              `${prefix}${volumePart}Chapter ${chapterNumber}: ${mainTitle}${subtitlePart}`.trim();

            // Release time logic
            let releaseTime: string | undefined = undefined;
            if (!ch.is_premium) {
              releaseTime = ch.created_at?.split(' ')[0] || undefined;
            } else if (ch.free_schedule !== null) {
              // Try to take date part from free_schedule (assuming ISO or similar format)
              releaseTime = ch.free_schedule?.split(' ')[0] || undefined;
            }

            // Chapter path — always use numeric ID
            const chPath = `${this.apisite}chapter/${ch.id}`;

            chapters.push({
              name: chName,
              path: chPath,
              releaseTime,
            });
          });
        }
      }
    }
    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: title,
      cover,
      summary,
      author,
      genres,
      status,
      chapters,
    };
    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const res = await fetchApi(chapterPath);
    if (!res.ok) throw new Error('Failed to load chapter');

    const data = await res.json();
    const chapter = Array.isArray(data) ? data[0] : data;

    if (!chapter?.content?.rendered) return 'Error: Chapter content not found';

    const title = chapter.title?.rendered?.trim() || '';

    let content = chapter.content.rendered;
    const $ = parseHTML(content);
    $(
      'script, style, .sharedaddy, .jp-relatedposts, .post-navigation',
    ).remove();
    // Remove all data-path-to-node and similar tracking attributes
    $('*').removeAttr('data-path-to-node');
    $('*').removeAttr('data-index-in-node');
    // Optional: restore censored words (base64 "Ymxvb2Q=" = "blood")
    $('.dh-censored').each((_i, el) => {
      const original = $(el).attr('data-original');
      if (original) {
        try {
          const decoded = Buffer.from(original, 'base64').toString('utf-8');
          $(el)
            .text(decoded)
            .removeClass('dh-censored')
            .removeAttr('data-original')
            .removeAttr('data-censored');
        } catch {}
      }
    });
    content = $.html() || $.text().trim();

    return `<h1>${title}</h1>\n🐼<br>\n${content}`;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const query = encodeURIComponent(searchTerm);
    const pagePath = pageNo > 1 ? `page/${pageNo}/` : '';
    const url = `${this.site}browse/${pagePath}?search=${query}&sort=new&order=desc&status=all`;

    const res = await fetchApi(url);
    if (!res.ok) return [];

    const html = await res.text();
    const $ = parseHTML(html);

    const novels: Plugin.NovelItem[] = [];

    // Main container → grid → direct <a class="group flex"> children
    $('#series-list-container a.group.flex').each((_i, el) => {
      const $a = $(el);

      const path = makeAbsolute($a.attr('href'), this.site);
      if (!path) return;

      // Title from h3 inside the card
      const $h3 = $a.find('h3');
      const name = $h3.text().trim();
      if (!name) return;

      // Cover image
      let cover = defaultCover;
      const $img = $a.find('img');
      if ($img.length) {
        cover = $img.attr('src') || $img.attr('data-src') || defaultCover;
      }

      novels.push({
        name,
        path,
        cover,
      });
    });

    return novels;
  }
}

export default new DragonholicTranslationsPlugin();

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
