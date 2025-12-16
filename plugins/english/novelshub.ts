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
const searchHeaders = {
  'User-Agent': 'Mozilla/5.0',
};

class novelshubPlugin implements Plugin.PluginBase {
  id = 'novelshub';
  name = 'Novels Hub';
  site = 'https://novelshub.org/';
  apiSite = 'https://api.novelshub.org/api/';
  version = '12.0.0';
  icon = 'src/en/novelshub/favicon.png';

  hideLocked = storage.get('hideLocked');
  pluginSettings = {
    hideLocked: {
      value: '',
      label: 'Hide locked chapters',
      type: 'Switch',
    },
  };

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];
    const url = this.site;
    console.log('Fetching from ', url);

    const res = await fetchApi(url, { headers: defaultHeaders });
    if (!res.ok) throw new Error('Error ' + res.statusText);
    console.log('Success');

    const text = await res.text();
    console.log('Success text');

    // 1️⃣ Collect RSC chunks
    const pushes: string[] = [];
    const re = /self\.__next_f\.push\(\[1,\s*"([\s\S]*?)"\]\)/g;

    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      pushes.push(m[1]);
      console.log('RSC chunk length:', m[1].length);
    }

    if (!pushes.length) {
      throw new Error('No RSC payload found');
    }

    const merged = pushes.join('');
    console.log('Merged RSC content length:', merged.length);
    console.log('Merged RSC content preview:', merged.slice(0, 500));

    // 2️⃣ Find Popular posts
    const contentRefMatch = merged.match(
      /(\{\\\"popularPosts[\s\S]*?\]),\\\"cdnOptions/,
    );
    console.log('Content reference match:', contentRefMatch);

    if (!contentRefMatch) {
      throw new Error('Content reference not found');
    }

    const contentRef = contentRefMatch[1];
    console.log('Content reference:', contentRef);

    // 3️⃣ Add bracket
    let encodedContent = contentRef + '}';
    encodedContent = encodedContent.replace(/\\/g, '');

    // 4️⃣ Decode JSON
    const json = JSON.parse(encodedContent);
    console.log('JSON: ', json);

    const novels: Plugin.NovelItem[] = [];
    const processedPaths = new Set<string>();

    const list = json?.popularPosts ?? [];
    list.forEach((book: any) => {
      // Avoid duplicates + ensure required fields exist
      const novelPath = `${this.site}series/${book.slug}` || '';
      if (novelPath && !processedPaths.has(novelPath)) {
        novels.push({
          name: book.postTitle,
          path: novelPath,
          cover: makeAbsolute(book.featuredImage, this.site) || defaultCover,
        });
        processedPaths.add(novelPath);
        console.log('Added novel:', book.postTitle, ' - ', novelPath);
      }
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const novelUrl = novelPath;
    console.log('Parsing novel from URL:', novelUrl);
    if (!novelUrl) throw new Error('Invalid novel URL');

    const result = await fetchApi(novelUrl, { headers: defaultHeaders });
    if (!result.ok)
      throw new Error('Failed to fetch novel' + result.statusText);
    console.log('Novel fetch successful');

    const text = await result.text();
    console.log('Success text');

    // 1️⃣ Collect RSC chunks
    const pushes: string[] = [];
    const re = /self\.__next_f\.push\(\[1,\s*"([\s\S]*?)"\]\)/g;

    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      pushes.push(m[1]);
      console.log('RSC chunk length:', m[1].length);
    }

    if (!pushes.length) {
      throw new Error('No RSC payload found');
    }

    const merged = pushes.join('');
    console.log('Merged RSC content length:', merged.length);
    console.log('Merged RSC content preview:', merged.slice(0, 500));

    // 2️⃣ Find Popular posts
    const contentRefMatch = merged.match(/(\{\\\"post\\":[\s\S]*?)\]\]\\n/);
    console.log('Content reference match:', contentRefMatch);

    if (!contentRefMatch) {
      throw new Error('Content reference not found');
    }

    const contentRef = contentRefMatch[1];
    console.log('Content reference:', contentRef);

    // 3️⃣ Add bracket
    let encodedContent = contentRef.replace(/\\/g, '');

    // 4️⃣ Decode JSON
    const json = JSON.parse(encodedContent);
    console.log('JSON: ', json);

    const data = json.post;

    // Map API status to our enum
    let status: string;
    switch (data.seriesStatus.toUpperCase()) {
      case 'ONGOING':
        status = NovelStatus.Completed;
        break;
      case 'COMPLETED':
        status = NovelStatus.Completed;
        break;
      case 'CANCELLED':
        status = NovelStatus.Cancelled;
        break;
      case 'HIATUS':
        status = NovelStatus.OnHiatus;
        break;
      default:
        status = NovelStatus.Unknown;
    }
    console.log('Novel status:', status);

    // === Fetch chapters from API ===
    const chapters: Plugin.ChapterItem[] = [];
    const chpatersJSON = data?.chapters ?? [];
    chpatersJSON.forEach((chapter: any) => {
      const chpaterPath = `${novelPath}/${chapter?.slug}`;
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
      const locked = chapter.isLocked === false;

      // ---- Emoji prefix ----
      let prefix = '';
      if (locked) prefix = '💎 ';
      console.log('Chapter prefix:', prefix);

      const name = chapter.title || '';
      console.log('Chapter title:', name);

      const chapterName = `${prefix}Chapter ${String(chapter.number).padStart(5, '0')}. ${name}`;
      console.log('Full chapter name:', chapterName);

      if (!(locked && this.hideLocked)) {
        chapters.push({
          name: chapterName,
          path: chpaterPath,
          chapterNumber: chapter.number,
          releaseTime,
        });
      }
    });

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: data.postTitle || 'Untitled',
      cover: data.featuredImage || defaultCover,
      summary: data.postContent
        .replace(/u003c/g, '<')
        .replace(/u003e/g, '>')
        .replace(/u0026/g, '&'),
      author: data.author || undefined,
      artist: data.artist || undefined,
      genres: Array.isArray(data.genres)
        ? data.genres
            .map((g: any) => g?.name)
            .filter(Boolean)
            .join(', ')
        : '',
      status: status,
      chapters,
    };
    console.log('Novel info:', novel);

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = chapterPath;
    const html = await fetchApi(url, { headers: defaultHeaders });

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
      /\"title\\\":\\\"([\s\S]*?)\\\",\\\"content\\\":\\\"([\s\S]*?)\\\",\\\"createdAt/,
    );
    console.log('Content reference match:', contentRefMatch);

    if (!contentRefMatch) {
      throw new Error('Content reference not found');
    }

    const title = contentRefMatch[1];

    const contentRef = contentRefMatch[2];
    console.log('Content reference:', contentRef);

    // 3️⃣ Resolve content
    let escapedContent: string;

    if (contentRef.startsWith('$')) {
      const slotId = contentRef.slice(1);
      console.log('Resolving slot ID:', slotId);

      const slotRegex = `n${slotId}:[a-zA-Z0-9]+,(.*)\\\\u003e[\\s\\S]*?:\\[\\\\\\"`;
      //  /n22:[a-zA-Z0-9]+,(.*)\\u003e[\s\S]*?:\[\\"/
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
    const url = `${this.apiSite}query?page=${pageNo}&perPage=20&searchTerm=${query}`;
    console.log('Searching novels from URL:', url);

    const res = await fetchApi(url, { headers: searchHeaders });
    const json = await res.json();

    console.log(json);
    const list = json?.posts || [];

    const novels: Plugin.NovelItem[] = list.map((book: any) => ({
      name: book.postTitle || 'Unknown',
      path: `${this.site}series/${book.slug}` || '',
      cover: makeAbsolute(book.featuredImage, this.site) || defaultCover,
    }));
    return novels;
  }
}

export default new novelshubPlugin();

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
