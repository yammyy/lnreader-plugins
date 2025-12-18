import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class WuxiaWorldEUPlugin implements Plugin.PluginBase {
  id = 'wuxiaworldEU';
  name = 'WuxiaWorld EU';
  site = 'https://wuxiaworld.eu/api/';
  version = '1.0.0';
  icon = 'src/en/wuxiaworldeu/favicon.png';

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    const limit = 20;
    const offset = limit * (pageNo - 1);
    const url = `${this.site}novels/?format=json&limit=${limit}&offset=${offset}&order=-total_views`;
    const res = await fetchApi(url);
    if (!res.ok) throw new Error('Failed to fetch popular novels');

    const json = await res.json();
    const list = json?.results || [];

    return list.map((book: any) => ({
      name: book.name,
      path: `novels/${book.slug}/?format=json`,
      cover: book.image || defaultCover,
    }));
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const novelUrl = makeAbsolute(novelPath, this.site);
    console.log('Novel URL: ', novelUrl);
    if (!novelUrl) throw new Error('Invalid novel URL');

    const result = await fetchApi(novelUrl);
    if (!result.ok) throw new Error('Failed to fetch novel');

    const data = await result.json();

    let name = data.name || '';
    if (data.other_names && data.other_names.length > 0) {
      const lastAlt = data.other_names[data.other_names.length - 1];
      name = `${name} / ${lastAlt}`;
    }

    const genres = data.categories?.map((c: any) => c.name).join(', ') || '';

    let status: string;
    switch (data.status) {
      case 'OG':
        status = NovelStatus.Ongoing;
        break;
      case 'CD':
        status = NovelStatus.Completed;
        break;
      default:
        if (data.status?.startsWith('H')) {
          status = NovelStatus.OnHiatus;
        } else {
          status = NovelStatus.Unknown;
        }
    }

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name,
      cover: data.image || defaultCover,
      summary: data.description,
      author: data.author?.name,
      genres,
      status,
      chapters: [],
    };

    // Fetch chapters
    const chaptersUrl = `${this.site}chapters/${data.slug}/?format=json`;
    const chapterRes = await fetchApi(chaptersUrl);
    if (!chapterRes.ok) return novel;

    const chapterList = await chapterRes.json();

    const chapters: Plugin.ChapterItem[] = [];
    chapterList.forEach((c: any) => {
      let releaseTime: string | undefined = undefined;
      if (c.timeAdded) {
        const date = new Date(c.timeAdded);
        if (!isNaN(date.getTime())) {
          releaseTime = date.toISOString().slice(0, 10);
        }
      }

      const chapterName = `Chapter ${String(c.index).padStart(5, '0')}. ${c.title}`;
      chapters.push({
        name: chapterName,
        path: `getchapter/${c.novSlugChapSlug}/?format=json`,
        releaseTime,
      });
    });

    novel.chapters = chapters;

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const chapterUrl = chapterPath;
    if (!chapterUrl) throw new Error('Invalid chapter URL');

    const result = await fetchApi(this.site + chapterUrl);
    if (!result.ok) throw new Error('Failed to fetch chapter');

    const json = await result.json();

    if (!json || !json.text) return 'Error: Chapter content is empty';

    const title = `Chapter ${json.index}. ${json.title}`;
    const content = json.text.replace(/\n/g, '<br>');

    const chapterHtml = `<h1>${title}</h1> 🐼<br> \n${content}`;

    return chapterHtml.trim();
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const query = searchTerm.trim().replace(/\s+/g, '+');
    const limit = 100;
    const offset = limit * (pageNo - 1);
    const url = `${this.site}search/?format=json&limit=${limit}&offset=${offset}&order=&search=${query}`;

    const res = await fetchApi(url);
    const json = await res.json();

    const list = json?.results || [];

    const novels: Plugin.NovelItem[] = list.map((book: any) => ({
      name: book.name || 'Unknown',
      path: `novels/${book.slug}/?format=json`,
      cover: book.image || defaultCover,
    }));
    return novels;
  }
}

export default new WuxiaWorldEUPlugin();

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
