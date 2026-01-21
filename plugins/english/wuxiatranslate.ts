import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

const BASE_URL = 'https://efrkglhpnooqmqhwfkfb.supabase.co/rest/v1/';
const ANON_KEY = 'sb_publishable_rs7n1XJd6XdyQQGZjggufQ_lnDleqqr';

const HEADERS = {
  'apikey': ANON_KEY,
  'Authorization': `Bearer ${ANON_KEY}`,
  'accept': 'application/json',
  'accept-profile': 'public',
  'content-type': 'application/json',
  'x-client-info': 'supabase-js/2.90.1',
};

class WuxiaTranslatePlugin implements Plugin.PluginBase {
  id = 'wuxiatranslate';
  name = 'Wuxia Translate';
  site = 'https://wuxiatranslate.com/';
  APIsite = 'https://efrkglhpnooqmqhwfkfb.supabase.co/';
  version = '1.0.1';
  icon = 'src/en/wuxiatranslate/favicon.png';

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo !== 1) return [];

    const url = makeAbsolute('functions/v1/get-home-data', this.APIsite) || '';

    const res = await fetchApi(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`Failed to fetch home data: ${res.status}`);

    const json = await res.json();

    const novels: Plugin.NovelItem[] = [];

    // popularUpdates first (main ranking/popular)
    (json.popularUpdates || []).forEach((item: any) => {
      if (!item.slug || !item.title) return;
      novels.push({
        name: item.title,
        path: item.slug,
        cover: item.cover_image || defaultCover,
      });
    });

    // then latestUpdates (avoid duplicates)
    (json.latestUpdates || []).forEach((item: any) => {
      if (!item.slug || !item.title || novels.some(n => n.path === item.slug))
        return;
      novels.push({
        name: item.title,
        path: item.slug,
        cover: item.cover_image || defaultCover,
      });
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const slug = novelPath;

    const url = `${BASE_URL}novels?select=id,title,original_title,author,status,genres,description,cover_image,rating,total_views,tags,type,release_year,slug,user_id&slug=eq.${encodeURIComponent(slug)}&publish_status=eq.Published&limit=1`;

    const res = await fetchApi(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`Failed to fetch novel: ${res.status}`);

    const novels = await res.json();
    if (!Array.isArray(novels) || novels.length === 0)
      throw new Error('Novel not found');

    const data = novels[0];

    let status = '';
    status = NovelStatus.Unknown;
    const st = (data.status || '').toLowerCase();
    if (st === 'ongoing') status = NovelStatus.Ongoing;
    else if (st === 'completed') status = NovelStatus.Completed;
    else if (st.includes('hiatus')) status = NovelStatus.OnHiatus;

    const novel: Plugin.SourceNovel = {
      path: slug,
      name: data.title || 'Untitled',
      cover: data.cover_image || defaultCover,
      summary: data.description || '',
      author: data.author || undefined,
      genres: (data.genres || []).join(', '),
      status,
      chapters: [],
    };

    // Fetch chapters
    const chaptersUrl = `${BASE_URL}chapters?select=id,title,release_date,status,coins,num_views,sort_order,created_at&novel_id=eq.${data.id}&order=sort_order.asc`;

    const chRes = await fetchApi(chaptersUrl, { headers: HEADERS });
    if (!chRes.ok) return novel;

    const chaptersData = await chRes.json();

    const chapters: Plugin.ChapterItem[] = (chaptersData || []).map(
      (ch: any) => {
        let releaseTime: string | undefined;
        if (ch.release_date) {
          try {
            releaseTime = new Date(ch.release_date).toISOString().split('T')[0];
          } catch {}
        }

        const prefix = ch.coins && ch.coins > 0 ? '🔒 ' : '';

        return {
          name: `${prefix}${ch.title || `Chapter ${ch.sort_order || '?'}`}`,
          path: `${slug}/${ch.sort_order}`, // slug + chapter NUMBER (not UUID!)
          releaseTime,
        };
      },
    );

    novel.chapters = chapters;

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    // chapterPath = "slug/chapter_number"  (e.g. "if-i-let-you-run-a-ranch-will-you-be-invincible-in-taming-beasts/1")
    const [slug, chapterNumStr] = chapterPath.split('/').filter(Boolean);
    const chapterNum = parseInt(chapterNumStr, 10);

    if (!slug || isNaN(chapterNum)) throw new Error('Invalid chapter path');

    const body = {
      p_novel_slug: slug,
      p_chapter_num: chapterNum,
    };

    const res = await fetchApi(`${BASE_URL}rpc/get_chapter_by_slug`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body),
    });

    if (!res.ok) throw new Error(`Failed to fetch chapter: ${res.status}`);

    const jsonArray = await res.json();
    if (!Array.isArray(jsonArray) || jsonArray.length === 0) {
      throw new Error('Chapter not found');
    }

    const chapter = jsonArray[0];

    const title =
      chapter.title || `Chapter ${chapter.sort_order || chapterNum}`;
    const content = chapter.content || 'No content available';

    // Add lock emoji if paid
    const prefix = chapter.coins && chapter.coins > 0 ? '🔒 ' : '';

    return `<h1>${prefix}${title}</h1>\n🐼<br>\n${content}`;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (!searchTerm.trim()) return [];

    const pattern = `%${searchTerm.trim().replace(/\s+/g, '%')}%`;

    const url = `${BASE_URL}novels?select=title,slug,cover_image&title=ilike.${encodeURIComponent(pattern)}&publish_status=eq.Published&limit=20&offset=${(pageNo - 1) * 20}&order=total_views.desc`;

    const res = await fetchApi(url, { headers: HEADERS });
    if (!res.ok) return [];

    const results = await res.json();

    return (results || []).map((item: any) => ({
      name: item.title || 'Untitled',
      path: item.slug || '',
      cover: item.cover_image || defaultCover,
    }));
  }
}

export default new WuxiaTranslatePlugin();

//DON'T CHANGE IT HERE!

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
