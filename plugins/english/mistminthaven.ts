import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { storage } from '@libs/storage';

class mistminthavenPlugin implements Plugin.PluginBase {
  id = 'mistminthaven';
  name = 'Mistmint Haven';
  site = 'https://api.mistminthaven.com/api/';
  chapterSite = 'https://mistminthaven.com/';
  version = '1.0.0';
  icon = 'src/en/mistminthaven/favicon.png';

  hideLocked = storage.get('hideLocked');
  pluginSettings = {
    hideLocked: {
      value: '',
      label: 'Hide locked chapters',
      type: 'Switch',
    },
  };

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return []; // API does not support pagination for popular novels
    const url = `${this.site}novels/top-views?type=week`;
    console.log('Fetching popular novels from URL:', url);

    const res = await fetchApi(url);
    if (!res.ok) throw new Error('Failed to fetch popular novels');

    const json = await res.json();
    const list = json?.data || [];

    return list.map((book: any) => ({
      name: book.title,
      path: `${this.site}novel/slug/${book.slug}` || '',
      cover: book.avatarUrl || defaultCover,
    }));
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const novelUrl = novelPath;
    console.log('Parsing novel from URL:', novelUrl);
    if (!novelUrl) throw new Error('Invalid novel URL');

    const result = await fetchApi(novelUrl);
    if (!result.ok) throw new Error('Failed to fetch novel');
    console.log('Novel fetch successful');

    const json = await result.json();
    console.log(json);

    const data = json.data;
    console.log('Novel data:', data);

    // Map API status to our enum
    let status: string;
    switch (data.status) {
      case 0:
        status = NovelStatus.Completed;
        break;
      case 1:
        status = NovelStatus.Ongoing;
        break;
      default:
        status = NovelStatus.Unknown;
    }
    console.log('Novel status:', status);

    // Combine genre + tags if needed
    const genres = data.genres.map((g: { name: any }) => g.name).join(', ');
    console.log('Novel genres:', genres);

    const slug = data.slug || '';
    console.log('Novel slug:', slug);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: data.title || 'Untitled',
      cover: data.avatarUrl || defaultCover,
      summary: data.description,
      author: data.author || undefined,
      genres: genres,
      status: status,
      chapters: [],
    };
    console.log('Novel info:', novel);

    // === Fetch chapters from API ===
    const chapters: Plugin.ChapterItem[] = [];

    const chaptersUrl = `${this.site}novels/slug/${slug}/chapters`;
    console.log('Fetching chapters from URL:', chaptersUrl);
    const chapterRes = await fetchApi(chaptersUrl);
    if (!chapterRes.ok) throw new Error('Failed to fetch novel');
    console.log('Chapters fetch successful');

    const chapterJson = await chapterRes.json();
    console.log(chapterJson);

    for (const block of chapterJson.data ?? []) {
      const volume = block.volumeTitle || '';
      console.log('Processing volume:', volume);

      for (const chapter of block.chapters ?? []) {
        console.log('Processing chapter:', chapter);

        // Format date as "YYYY-MM-DD"
        let releaseTime: string | undefined = undefined;
        if (chapter.createdAt) {
          const date = new Date(chapter.createdAt);
          const yyyy = date.getFullYear();
          const mm = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
          const dd = String(date.getDate()).padStart(2, '0');
          releaseTime = `${yyyy}-${mm}-${dd}`;
        }
        console.log('Chapter release time:', releaseTime);

        // ---- Determine lock/VIP status ----
        const locked = chapter.isFree === false;

        // ---- Emoji prefix ----
        let prefix = '';
        if (locked) prefix = '💎 ';
        console.log('Chapter prefix:', prefix);

        const name = chapter.title || '';
        console.log('Chapter title:', name);

        const chapterName = `${prefix}Chapter ${String(chapter.chapterNumber).padStart(5, '0')}. ${name}`;
        console.log('Full chapter name:', chapterName);

        if (!(locked && this.hideLocked)) {
          chapters.push({
            name: chapterName,
            path: `${this.chapterSite}novels/${slug}/${chapter.slug}` || '',
            releaseTime: releaseTime || undefined,
          });
          console.log('Chapter added to list');
        }
      }
    }
    console.log('Total chapters parsed:', chapters.length);

    novel.chapters = chapters;

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = chapterPath;
    const html = await fetchApi(url);

    const text = await html.text();
    console.log('Fetched chapter HTML');

    // 1️⃣ Collect RSC chunks
    const pushes: string[] = [];
    const re = /self\.__next_f\.push\(\[1,\s*"([\s\S]*?)"\]\)/g;

    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      pushes.push(m[1]);
      console.log('Found RSC chunk:', m[1]);
      console.log('RSC chunk length:', m[1].length);
    }

    if (!pushes.length) {
      throw new Error('No RSC payload found');
    }

    const merged = pushes.join('');
    console.log('Merged RSC content length:', merged.length);
    console.log('Merged RSC content preview:', merged.slice(0, 500));

    // 2️⃣ Find content reference
    const contentRefMatch = merged.match(
      /\{\\"content\\":\\"([\s\S]*?)\\",\\"contactU/,
    );
    console.log('Content reference match:', contentRefMatch);

    if (!contentRefMatch) {
      throw new Error('Content reference not found');
    }

    const contentRef = contentRefMatch[1];
    console.log('Content reference:', contentRef);

    // 3️⃣ Resolve content
    let escapedContent: string;

    if (contentRef.startsWith('$')) {
      const slotId = contentRef.slice(1);
      console.log('Resolving slot ID:', slotId);

      const slotRegex = `n${slotId}:[a-zA-Z0-9]+,(.*)\\\\u003e[\\s\\S]*?:`;
      //  /n20:[a-zA-Z0-9]+,(.*)\\u003e[\s\S]*?:/
      console.log('Regex for slot:', slotRegex);
      let regex = new RegExp('');
      try {
        regex = new RegExp(slotRegex);
      } catch (e) {
        console.error('Error creating regex:', e);
      }
      console.log('new RegExp(regex):', regex);
      console.log('Mergrd content length:', merged.length);
      const slotMatch = merged.match(regex);
      console.log('Slot match:', slotMatch);

      if (!slotMatch) {
        throw new Error(`Slot ${slotId} not found`);
      }

      escapedContent = slotMatch[1];
    } else {
      escapedContent = contentRef;
    }
    console.log('Escaped content:', escapedContent);

    // 4️⃣ Decode HTML
    const decoded = escapedContent
      .replace(/\\u003c/g, '<')
      .replace(/\\u003e/g, '>')
      .replace(/\\u0026/g, '&')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
      .replace(/\\n/g, '<br>');
    console.log('Decoded content:', decoded);

    return decoded.trim();
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const query = searchTerm.trim().replace(/\s+/g, '+');
    const url = `${this.site}novel?keyword=${query}&limit=100&skipPage=0`;
    console.log('Searching novels from URL:', url);

    const res = await fetchApi(url);
    const json = await res.json();

    console.log(json);
    const list = json?.data || [];

    const novels: Plugin.NovelItem[] = list.map((book: any) => ({
      name: book.title || 'Unknown',
      path: `${this.site}novel/slug/${book.slug}` || '',
      cover: book.avatarUrl || defaultCover,
    }));
    return novels;
  }
}

export default new mistminthavenPlugin();

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
