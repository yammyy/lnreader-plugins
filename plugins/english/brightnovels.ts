import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { storage } from '@libs/storage';

const defaultHeaders = {
  'User-Agent': 'Mozilla/5.0',
  'Accept': 'text/html',
  'Accept-Encoding': 'gzip, deflate',
  'Accept-Language': 'en-US,en;q=0.9',
};
const chaptersHeaders = {
  'User-Agent': 'Mozilla/5.0',
};

class brightnovelsPlugin implements Plugin.PluginBase {
  id = 'brightnovels';
  name = 'Bright Novels';
  site = 'https://brightnovels.com/';
  version = '1.0.0';
  icon = 'src/en/brightnovels/favicon.png';

  hideLocked = storage.get('hideLocked');
  pluginSettings = {
    hideLocked: {
      value: '',
      label: 'Hide locked chapters',
      type: 'Switch',
    },
  };

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    const url = this.site;
    console.log('Fetching popular novels from URL:', url);

    let res = await fetchApi(url, {
      headers: defaultHeaders,
    });
    console.log(res.ok);
    if (!res.ok) throw new Error('Failed to fetch homepage');

    const novels: Plugin.NovelItem[] = [];
    const processedPaths = new Set<string>();

    let json: any = null;
    const contentType = res.headers.get('content-type');
    console.log('Content-Type:', contentType);
    if (contentType?.includes('text/html')) {
      const $ = parseHTML(await res.text());
      const app = $('#app');
      console.log('Found #app element:', app.length > 0);
      const encodedHTML = app.attr('data-page') ?? app.attr('data-props');
      if (!encodedHTML) {
        throw new Error('data-props not found');
      }
      try {
        json = JSON.parse(encodedHTML);
      } catch (e) {
        throw new Error('Failed to parse data-props JSON');
      }
    } else if (contentType?.includes('application/json')) {
      // If the response is JSON, parse it directly
      json = await res.json();
    }

    console.log('Parsed JSON:', json?.props?.featuredNovels);
    const list = json?.props?.featuredNovels || [];
    list.map((book: any) => {
      // Avoid duplicates + ensure required fields exist
      const novelPath = `${this.site}series/${book.slug}` || '';
      if (novelPath && !processedPaths.has(novelPath)) {
        novels.push({
          name: book.title,
          path: novelPath,
          cover: makeAbsolute(book.coverImage, this.site) || defaultCover,
        });
        processedPaths.add(novelPath);
        console.log('Added novel:', book.title);
      }
    });
    console.log('Parsed JSON:', json?.props?.popularNovels);
    const list2 = json?.props?.popularNovels || [];
    list2.map((book: any) => {
      // Avoid duplicates + ensure required fields exist
      const novelPath = `${this.site}series/${book.slug}` || '';
      if (novelPath && !processedPaths.has(novelPath)) {
        novels.push({
          name: book.title,
          path: novelPath,
          cover: makeAbsolute(book.coverImage, this.site) || defaultCover,
        });
        processedPaths.add(novelPath);
        console.log('Added novel:', book.title);
      }
    });

    return novels;
  }

  cleanDescriptionText(raw: string): string {
    const $ = parseHTML(raw);

    // Удаляем все script-теги
    $('script').remove();

    // Берём чистый текст
    return $.text()
      .replace(/\r\n\r\n+/g, '\n\n')
      .trim();
  }

  toDateOnly(value?: string | null): string | undefined {
    if (!value) return undefined;

    const d = new Date(value);
    if (isNaN(d.getTime())) return undefined;

    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');

    return `${yyyy}-${mm}-${dd}`;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const novelUrl = novelPath;
    console.log('Parsing novel from URL:', novelUrl);
    if (!novelUrl) throw new Error('Invalid novel URL');

    const result = await fetchApi(novelUrl, { defaultHeaders });
    if (!result.ok) throw new Error('Failed to fetch novel');

    const contentType = result.headers.get('content-type');
    console.log('Content-Type:', contentType);

    const $ = parseHTML(await result.text());
    const app = $('#app');
    console.log('Found #app element:', app.length > 0);
    const encodedHTML = app.attr('data-page') ?? app.attr('data-props');
    if (!encodedHTML) {
      throw new Error('data-props not found');
    }
    let json: any = null;
    try {
      json = JSON.parse(encodedHTML);
    } catch (e) {
      throw new Error('Failed to parse data-props JSON');
    }

    console.log('Parsed JSON:', json?.props?.series);
    const novelJSON = json?.props?.series || {};

    // Map API status to our enum
    let status: string;
    switch (novelJSON.story_state.toLowerCase()) {
      case 'ongoing':
        status = NovelStatus.Ongoing;
        break;
      case 'completed':
        status = NovelStatus.Completed;
        break;
      case 'cancelled':
        status = NovelStatus.Cancelled;
        break;
      case 'hiatus':
        status = NovelStatus.OnHiatus;
        break;
      default:
        status = NovelStatus.Unknown;
    }

    const title = novelJSON.title;
    const altTitle = novelJSON.alt_title;
    const novelName =
      altTitle && altTitle.trim() !== '' ? `${title} / ${altTitle}` : title;

    let genres = '';
    // Combine genre + tags if needed
    if (!novelJSON.genres) {
      genres = '';
    } else {
      genres = novelJSON.genres.map((g: { name: any }) => g.name).join(', ');
      console.log('Novel genres:', genres);
    }

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: novelName || 'Untitled',
      summary: this.cleanDescriptionText(novelJSON.description),
      author: undefined,
      genres: genres,
      status: status,
      chapters: [],
    };

    // === Fetch chapters from API ===
    const chapters: Plugin.ChapterItem[] = [];
    const chaptersUrl = `${novelPath}/chapters?sort_order=asc`;
    console.log('Fetching chapters from URL:', chaptersUrl);

    const chapterRes = await fetchApi(chaptersUrl, {
      headers: chaptersHeaders,
    });
    if (!chapterRes.ok) return novel;

    const chapterJson = await chapterRes.json();
    console.log(chapterJson);
    if (!chapterJson.chapters) return novel;

    chapterJson.chapters.forEach((c: any) => {
      // ---- Determine lock status ----
      const locked = c.is_premium === true;
      console.log('Chapter locked status:', locked);

      let releaseTime: string | undefined;
      if (locked) {
        releaseTime = !c.unlocked_at
          ? this.toDateOnly(c.unlocked_at)
          : this.toDateOnly(c.index_at);
      } else {
        releaseTime = this.toDateOnly(c.index_at);
      }

      // ---- Emoji prefix ----
      let prefix = '';
      if (locked) prefix = '🔒 ';

      if (!(locked && this.hideLocked)) {
        const chapterName = `${prefix}Chapter ${String(c.number).padStart(5, '0')}. ${c.title || ''}`;
        chapters.push({
          name: chapterName,
          path: `${novelPath}/${c.slug}` || '',
          releaseTime: releaseTime || undefined,
        });
      }
    });

    novel.chapters = chapters;

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const chapterUrl = chapterPath;
    console.log('Parsing chapter from URL:', chapterUrl);
    if (!chapterUrl) throw new Error('Invalid chapter URL');

    const result = await fetchApi(chapterUrl, { defaultHeaders });
    if (!result.ok) throw new Error('Failed to fetch chapter');

    const contentType = result.headers.get('content-type');
    console.log('Content-Type:', contentType);

    const $ = parseHTML(await result.text());
    const app = $('#app');
    console.log('Found #app element:', app.length > 0);
    const encodedHTML = app.attr('data-page') ?? app.attr('data-props');
    if (!encodedHTML) {
      throw new Error('data-props not found');
    }
    let json: any = null;
    try {
      json = JSON.parse(encodedHTML);
    } catch (e) {
      throw new Error('Failed to parse data-props JSON');
    }

    console.log('Parsed JSON:', json?.props?.chapter?.content);

    const content = json?.props?.chapter?.content || {};

    const title = json?.props?.chapter?.title || '';
    const chapNum = json?.props?.chapter?.number || '';
    let contentHTML = `<h1>Chapter ${String(chapNum).padStart(5, '0')}. ${title}</h1>\n${content}`;

    return contentHTML;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const query = encodeURIComponent(searchTerm);
    const url = `${this.site}api/search?query=${query}`;
    console.log('Searching novels from URL:', url);

    const res = await fetchApi(url);
    const json = await res.json();

    console.log(json);
    const list = json?.data?.series || []; // instead of json?.data?.records

    const novels: Plugin.NovelItem[] = list.map((book: any) => ({
      name: book.title || 'Unknown',
      path: `${this.site}series/${book.slug}` || '',
      cover: makeAbsolute(book.cover.url, this.site) || defaultCover,
    }));
    return novels;
  }
}

export default new brightnovelsPlugin();

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
