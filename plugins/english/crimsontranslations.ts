import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class CrimsonTranslationsPlugin implements Plugin.PluginBase {
  id = 'crimsontranslations';
  name = 'Crimson Translations';
  icon = 'src/en/crimsontranslations/favicon.png';
  site = 'https://www.crimsontranslations.com/';
  version = '1.0.0';

  // Base API prefix used in all requests
  apiBase = `${this.site}api/`;

  // Optional: helps some fetchers with correct headers
  defaultHeaders = {
    'Accept': 'application/json, text/plain, */*',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': this.site,
  };

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    // This site shows featured/latest/random on home → we use /api/ (no pagination here)
    if (pageNo > 1) return [];

    const url = this.apiBase;
    const res = await fetchApi(url, { headers: this.defaultHeaders });

    if (!res.ok) {
      console.log('popularNovels failed:', res.status);
      return [];
    }

    const json = await res.json();

    const novels: Plugin.NovelItem[] = [];

    // Merge all three lists and deduplicate by book_id
    const allBooks = [
      ...(json.latestBooks || []),
      ...(json.randomNonBLBooks || []),
    ];

    const seen = new Set<number>();

    for (const b of allBooks) {
      const id = b.book_id;
      if (seen.has(id)) continue;
      seen.add(id);

      novels.push({
        name: b.english_book_name || b.original_book_name || 'Untitled',
        path: String(id), // we only need book_id – we'll build full path later
        cover: this.makeCoverUrl(b.cover_image),
      });
    }

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const bookId = novelPath.trim();
    if (!/^\d+$/.test(bookId)) {
      throw new Error('Invalid novel path (expected book_id)');
    }

    const url = `${this.apiBase}${bookId}`;
    const res = await fetchApi(url, { headers: this.defaultHeaders });

    if (!res.ok) {
      throw new Error(`Failed to fetch novel: ${res.status}`);
    }

    const json = await res.json();
    const details = json.bookDetails;
    const chaptersRaw = json.chapters || [];

    if (!details?.book_id) {
      throw new Error('Invalid book details response');
    }

    // Map status
    let status = '';
    status = NovelStatus.Unknown;
    const comp = (details.completion_statuses || '').toLowerCase();
    if (comp.includes('complete') || comp === 'completed') {
      status = NovelStatus.Completed;
    } else if (comp.includes('ongoing')) {
      status = NovelStatus.Ongoing;
    }

    const chapters: Plugin.ChapterItem[] = chaptersRaw.map((ch: any) => ({
      name: ch.title || `Chapter ${ch.chapter_id}`,
      path: `${bookId}/${ch.chapter_id}`,
      releaseTime: ch.uploaded_time
        ? new Date(ch.uploaded_time).toISOString().split('T')[0]
        : undefined,
    }));

    return {
      path: bookId,
      name:
        details.english_book_name && details.original_book_name
          ? `${details.english_book_name} (${details.original_book_name})`
          : details.english_book_name ||
            details.original_book_name ||
            'Untitled',
      cover: this.makeCoverUrl(details.cover_image),
      author: details.author || undefined,
      summary: details.description || '',
      genres: details.genres || '',
      status,
      chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    // chapterPath = "bookId/chapterId"
    const [bookId, chapterId] = chapterPath.split('/').map(s => s.trim());

    if (
      !bookId ||
      !chapterId ||
      !/^\d+$/.test(bookId) ||
      !/^\d+$/.test(chapterId)
    ) {
      throw new Error('Invalid chapter path format');
    }

    const url = `${this.apiBase}${bookId}/${chapterId}`;
    const res = await fetchApi(url, { headers: this.defaultHeaders });

    if (!res.ok) {
      throw new Error(`Failed to fetch chapter: ${res.status}`);
    }

    const json = await res.json();
    const contentObj = json.chapterContent;

    if (!contentObj?.content) {
      return 'Error: Chapter content not found';
    }

    let html = `<h1>${contentObj.title || 'Chapter'}</h1>\n🐼<br>\n`;

    // The content seems to be plain text with \n\n between paragraphs
    const paragraphs = contentObj.content
      .split(/\n{2,}/)
      .map(p => p.trim())
      .filter(Boolean);

    html += paragraphs
      .map(p => `<p>${p.replace(/\n/g, '<br>')}</p>`)
      .join('\n');

    // Optional: add footnotes / notes if present
    if (contentObj.footnote) {
      html += `\n<hr><p><small>Footnote: ${contentObj.footnote}</small></p>`;
    }
    if (contentObj.chapter_tl_note) {
      html += `\n<hr><p><small>Translator Note: ${contentObj.chapter_tl_note}</small></p>`;
    }

    return html;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (!searchTerm.trim()) return [];

    const params = new URLSearchParams({
      page: String(pageNo),
      pageSize: '50',
      diversity: 'All',
      original_language: 'All',
      completion_status: 'All',
      ending: 'All',
      word_count: 'All',
      book_name: searchTerm.trim(),
      sort_by: 'newest',
      min_word_count: 'Any',
      max_word_count: 'Any',
    });

    const url = `${this.apiBase}searchbook?${params.toString()}`;
    const res = await fetchApi(url, { headers: this.defaultHeaders });

    if (!res.ok) {
      console.log('search failed:', res.status);
      return [];
    }

    const json = await res.json();
    const books = json.books || [];

    return books.map((b: any) => ({
      name: b.english_book_name || b.original_book_name || 'Untitled',
      path: String(b.book_id),
      cover: this.makeCoverUrl(b.cover_image),
    }));
  }

  // Helpers -------------------------------------------------------------------

  private makeCoverUrl(path: string | undefined): string {
    if (!path) return defaultCover;
    if (path.startsWith('http')) return path;
    if (path.startsWith('/')) return `${this.site}${path.slice(1)}`;
    return `${this.site}${path}`;
  }
}

export default new CrimsonTranslationsPlugin();
