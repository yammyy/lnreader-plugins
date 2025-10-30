import { load as parseHTML } from 'cheerio';
import { fetchApi, fetchFile } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { Filters, FilterTypes } from '@libs/filterInputs';
import { storage } from '@libs/storage';

const defaultHeaders = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'ru,en-US;q=0.9,en;q=0.8,zh-TW;q=0.7,zh-CN;q=0.6,zh;q=0.5',
  'Cache-Control': 'no-cache',
  'DNT': '1', // optional, Do Not Track
  'lang': 'en_US', // required by API
  'Origin': 'https://botitranslation.com', // usually required for CORS
  'Pragma': 'no-cache',
  'Referer': 'https://botitranslation.com/', // sometimes required
  'Site-Domain': 'botitranslation.com', // custom API header
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
};

class BOTITranslationPlugin implements Plugin.PluginBase {
  id = 'BOTITranslation';
  name = 'BOTITranslation';
  site = 'https://api.mystorywave.com/story-wave-backend/api/v1/';
  version = '7.0.0';
  icon = 'src/en/BOTI/favicon.png';

  hideLocked = storage.get('hideLocked');
  pluginSettings = {
    hideLocked: {
      value: '',
      label: 'Hide locked chapters',
      type: 'Switch',
    },
  };

  filters = {
    genres: {
      type: FilterTypes.CheckboxGroup,
      label: 'Genres',
      value: [],
      options: [
        { label: 'Fantasy', value: '1' },
        { label: 'Sci-fi', value: '2' },
        { label: 'Sports', value: '3' },
        { label: 'Urban', value: '4' },
        { label: 'Eastern Fantasy', value: '5' },
        { label: 'Horror & Thriller', value: '6' },
        { label: 'Video Game', value: '7' },
        { label: 'History', value: '8' },
        { label: 'War', value: '9' },
        { label: 'Urban Romance', value: '10' },
        { label: 'Fantasy Romance', value: '11' },
        { label: 'Historical Romance', value: '12' },
        { label: 'Teen', value: '13' },
        { label: 'LGBT+', value: '14' },
        { label: 'OTHERS+', value: '16' },
      ],
    },
  } satisfies Filters;

  imageRequestInit = {
    headers: defaultHeaders,
  };

  async popularNovels(
    pageNo: number,
    { filters }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const genreParam = filters.genres.value.length
      ? '&genre=' + filters.genres.value.join(',')
      : '&genre=1';
    const url = `${this.site}content/books/rank/readCounts?pageNumber=${pageNo}&pageSize=20${genreParam}`;
    console.log('Fetching popular novels from URL:', url);

    const res = await fetchApi(url, {
      headers: defaultHeaders,
    });
    if (!res.ok) throw new Error('Failed to fetch popular novels');

    const json = await res.json();
    const list = json?.data?.list || [];

    return list.map((book: any) => ({
      name: book.title,
      path: makeAbsolute(`content/books/${book.id}`, this.site) || '',
      cover: book.coverImgUrl || defaultCover,
    }));
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const novelUrl = makeAbsolute(novelPath, this.site);
    if (!novelUrl) throw new Error('Invalid novel URL');

    const result = await fetchApi(novelUrl, {
      headers: defaultHeaders,
    });
    if (!result.ok) throw new Error('Failed to fetch novel');

    const json = await result.json();
    console.log(json);

    if (json.code !== 0 || !json.data) throw new Error('Invalid API response');

    const data = json.data;

    // Map API status to our enum
    let status: string;
    switch (data.status) {
      case 0:
        status = NovelStatus.Ongoing;
        break;
      case 1:
        status = NovelStatus.Completed;
        break;
      default:
        status = NovelStatus.Unknown;
    }

    // Combine genre + tags if needed
    const genres = data.genreName || 'Other';

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: data.title || 'Untitled',
      cover: data.coverImgUrl || defaultCover,
      summary: data.synopsis,
      author: data.authorPseudonym || undefined,
      genres: genres,
      status: status,
      rating: data.ratingCounts,
      chapters: [],
    };

    // === Fetch chapters from API ===
    const pageSize = 100;
    const totalChapters = data.publishedChapters || 0;
    const totalPages = Math.ceil(totalChapters / pageSize);

    const chapters: Plugin.ChapterItem[] = [];

    for (let page = 1; page <= totalPages; page++) {
      const chaptersUrl = `content/chapters/page?sortDirection=ASC&bookId=${data.id}&pageNumber=${page}&pageSize=${pageSize}`;
      const chapterRes = await fetchApi(chaptersUrl, {
        headers: defaultHeaders,
      });
      if (!chapterRes.ok) continue;

      const chapterJson = await chapterRes.json();
      if (chapterJson.code !== 0 || !chapterJson.data?.records) continue;

      chapterJson.data.records.forEach((c: any) => {
        // Format date as "YYYY-MM-DD"
        let releaseTime: string | undefined = undefined;
        if (c.publishTime) {
          const date = new Date(c.publishTime);
          const yyyy = date.getFullYear();
          const mm = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
          const dd = String(date.getDate()).padStart(2, '0');
          releaseTime = `${yyyy}-${mm}-${dd}`;
        }
        const locked = c.paywallStatus === 'charge';

        if (!(locked && this.hideLocked)) {
          chapters.push({
            name: locked
              ? `🔒 Chapter ${String(c.chapterOrder).padStart(5, '0')}. ${c.title}`
              : `Chapter ${String(c.chapterOrder).padStart(5, '0')}. ${c.title}`,
            path: makeAbsolute(`content/chapters/${c.id}`, this.site) || '',
            releaseTime: releaseTime || undefined,
          });
        }
      });
    }

    novel.chapters = chapters;

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const chapterUrl = makeAbsolute(chapterPath, this.site);
    if (!chapterUrl) throw new Error('Invalid chapter URL');

    const result = await fetchApi(chapterUrl, {
      headers: defaultHeaders,
    });
    if (!result.ok) throw new Error('Failed to fetch chapter');

    const dataJson = await result.json();
    const c = dataJson.data;

    if (!c || !c.content) return 'Error: Chapter content is empty';

    // Prepend <h1> with chapter number and title
    let chapterHtml = `<h1>Chapter ${c.chapterOrder}. ${c.title}</h1> 🐼<br> \n${c.content}`;

    // Append author note if exists
    if (c.authorNote) {
      chapterHtml += `\n<p>${c.authorNote}</p>`;
    }

    return chapterHtml.trim();
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const query = searchTerm.trim().replace(/\s+/g, '+');
    const url = `${this.site}content/books/search?keyWord=${query}&pageNumber=${pageNo}&pageSize=50`;
    console.log('Searching novels from URL:', url);

    const res = await fetchApi(url, {
      headers: defaultHeaders,
    });
    const json = await res.json();

    console.log(json);
    const list = json?.data?.records || [];

    const novels: Plugin.NovelItem[] = list.map((book: any) => ({
      name: book.bookName || 'Unknown',
      path: makeAbsolute(`content/books/${book.id}`, this.site) || '',
      cover: book.bookCoverUrl || defaultCover,
    }));
    return novels;
  }
}

export default new BOTITranslationPlugin();

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
