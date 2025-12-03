import { fetchApi } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { storage } from '@libs/storage';

class transcendentaltlsPlugin implements Plugin.PluginBase {
  id = 'transcendentaltls';
  name = 'Transcendental';
  site = 'https://transcendentaltls.com/api/general/';
  version = '1.0.0';
  icon = 'src/en/transcendentaltls/favicon.ico';

  hideLocked = storage.get('hideLocked');
  pluginSettings = {
    hideLocked: {
      value: '',
      label: 'Hide locked chapters',
      type: 'Switch',
    },
  };

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    const url = `${this.site}mainContent`;
    console.log('Fetching home page URL:', url);

    const res = await fetchApi(url);
    if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);

    const json = await res.json();

    const novels: Plugin.NovelItem[] = [];

    const LA = json?.latestUpdates || [];

    LA.forEach((book: any) => {
      novels.push({
        name: book.name || 'Unknown',
        path: book.novelTag
          ? `${this.site}novelDetails?novelTag=${encodeURIComponent(book.novelTag)}`
          : '',
        cover: book.coverImage || defaultCover,
      });
    });

    const slides = json?.slides || [];

    slides.forEach((book: any) => {
      novels.push({
        name: book.title || 'Unknown',
        path: book.novelTag
          ? `${this.site}novelDetails?novelTag=${encodeURIComponent(book.novelTag)}`
          : '',
        cover: book.bgImage || defaultCover,
      });
    });

    const trending = json?.trending || [];

    trending.forEach((book: any) => {
      novels.push({
        name: book.title || 'Unknown',
        path: book.novelTag
          ? `${this.site}novelDetails?novelTag=${encodeURIComponent(book.novelTag)}`
          : '',
        cover: book.coverImage || defaultCover,
      });
    });

    const uniqueNovels = Array.from(
      new Map(novels.map(n => [n.path, n])).values(),
    );
    return uniqueNovels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const novelUrl = novelPath;
    console.log('Parsing novel from URL:', novelUrl);
    if (!novelUrl) throw new Error('Invalid novel URL');

    const result = await fetchApi(novelUrl);
    if (!result.ok) throw new Error('Failed to fetch novel');

    const json = await result.json();
    console.log(json);

    if (json.error || !json.novel) throw new Error('Invalid API response');

    const data = json.novel;
    const chaptersJSON = json.chapters || [];

    // Map API status to our enum
    let status: string;
    switch (data.status) {
      case 'ONGOING':
        status = NovelStatus.Ongoing;
        break;
      case 'COMPLETED':
        status = NovelStatus.Completed;
        break;
      case 'DROPPED':
        status = NovelStatus.Cancelled;
        break;
      default:
        status = NovelStatus.Unknown;
    }

    // Combine genre + tags if needed
    const genres =
      data.genres.map((g: { name: any }) => g.name).join(', ') || 'Other';

    // === Fetch chapters from API ===
    const chapters: Plugin.ChapterItem[] = [];
    chaptersJSON.forEach((c: any) => {
      // Format date as "YYYY-MM-DD"
      let releaseTime: string | undefined = undefined;
      if (c.createdAt) {
        const date = new Date(c.createdAt);
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-based
        const dd = String(date.getDate()).padStart(2, '0');
        releaseTime = `${yyyy}-${mm}-${dd}`;
      }

      // ---- Determine lock/VIP status ----
      const locked = c.isLocked === true;

      // ---- Emoji prefix ----
      let prefix = '';
      if (locked) prefix = '🔒 ';

      if (!(locked && this.hideLocked)) {
        const chapterName = `${prefix}Chapter ${String(c.chapterNumber).padStart(5, '0')}${c.title ? `. ${c.title}` : ''}`;
        chapters.push({
          name: chapterName,
          path: `${this.site}chapter?novelTag=${encodeURIComponent(data.novelTag)}&chapterNumber=${c.chapterNumber}`,
          releaseTime: releaseTime || undefined,
        });
      }
    });

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: `${data.name} / ${data.originalName}` || 'Untitled',
      cover: data.coverImage || defaultCover,
      summary: data.description,
      author: data.author || undefined,
      genres: genres,
      status: status,
      rating: data.rating || 0,
      chapters: chapters,
    };

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const chapterUrl = chapterPath;
    console.log('Parsing chapter from URL:', chapterUrl);
    if (!chapterUrl) throw new Error('Invalid chapter URL');

    const result = await fetchApi(chapterUrl);
    if (!result.ok) throw new Error('Failed to fetch chapter');

    const dataJson = await result.json();
    console.log(dataJson);
    const c = dataJson.chapter;

    if (!c || !c.content.html) return 'Error: Chapter content is empty';

    // Prepend <h1> with chapter number and title
    let chapterHtml = `<h1>Chapter ${c.chapterNumber}. ${c.title}</h1> 🐼<br> \n${c.content}`;

    return chapterHtml.trim();
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    // Load latest updates
    const response = await fetchApi(this.site + 'latestUpdates');
    const data = await response.json();
    console.log(data);

    // Ensure we actually have novels
    const novels: any[] = data?.novels || [];

    // Normalize search key (case-insensitive)
    const key = searchTerm.toLowerCase();

    // Filter only novels whose "name" contains the search substring
    const results = novels.filter(novel =>
      novel.name.toLowerCase().includes(key),
    );

    const resultNovels = results.map((book: any) => ({
      // Novel title or fallback
      name: book.name || 'Unknown',
      // Build full path using novel id
      path: book.novelTag
        ? `${this.site}novelDetails?novelTag=${encodeURIComponent(book.novelTag)}`
        : '',
      // Use provided cover or fallback image
      cover: book.coverImage || defaultCover,
    }));

    return resultNovels;
  }
}

export default new transcendentaltlsPlugin();
