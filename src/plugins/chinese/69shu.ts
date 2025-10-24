import { load as parseHTML } from 'cheerio';
import { fetchText } from '@libs/fetch';
import { FilterTypes, Filters } from '@libs/filterInputs';
import { Plugin } from '@typings/plugin';
import { NovelStatus } from '@libs/novelStatus';

class Shu69 implements Plugin.PluginBase {
  private fetchOptions = {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0',
      'Accept':
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-US,us;q=0.5',
      'Referer': 'https://www.69shu.xyz/', // Referer
      'DNT': '1', // Do Not Track
      'Upgrade-Insecure-Requests': '1', // Upgrade-Insecure-Requests
    },
  };

  id = '69shu';
  name = '69书吧';
  icon = 'src/cn/69shu/icon.png';
  site = 'https://www.69shu.xyz';
  version = '5.2.2';

  async popularNovels(
    pageNo: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    let url: string;
    if (showLatestNovels) {
      url = `${this.site}/rank/lastupdate/${pageNo}.html`;
    } else if (filters.sort.value === 'none') {
      url = `${this.site}/rank/${filters.rank.value}/${pageNo}.html`;
    } else {
      url = `${this.site}/sort/${filters.sort.value}/${pageNo}.html`;
    }

    const body = await fetchText(url, this.fetchOptions);
    if (body === '')
      throw Error('Не удалось получить список новинок, проверьте сеть.');

    const loadedCheerio = parseHTML(body);

    const novels: Plugin.NovelItem[] = [];

    loadedCheerio('div.book-coverlist').each((i, el) => {
      const url = loadedCheerio(el).find('a.cover').attr('href');

      const novelName = loadedCheerio(el).find('h4.name').text().trim();
      const novelCover = loadedCheerio(el).find('a.cover > img').attr('src');
      if (!url) return;

      const novel = {
        name: novelName,
        cover: novelCover,
        path: url.replace(this.site, ''),
      };

      novels.push(novel);
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = this.site + novelPath;

    const body = await fetchText(url, this.fetchOptions);
    if (body === '')
      throw Error('Невозможно получить новый контент, проверьте сеть.');

    const loadedCheerio = parseHTML(body);

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      chapters: [],
      name: loadedCheerio('h1').text().trim(),
    };

    novel.cover = loadedCheerio('div.cover > img').attr('src');

    novel.summary = await translate(
      loadedCheerio('#bookIntro').text().trim(),
      'ru',
    );

    const bookInfo = loadedCheerio('div.caption-bookinfo > p');

    novel.author = bookInfo.find('a').attr('title');

    novel.artist = undefined;

    novel.status = bookInfo.text().includes('连载')
      ? NovelStatus.Ongoing
      : NovelStatus.Completed;

    novel.genres = '';

    // Table of Content is on a different page than the summary page
    const chapters: Plugin.ChapterItem[] = [];

    const allUrl = loadedCheerio('dd.all > a').attr('href');
    if (allUrl) {
      // --- Start: Fetch chapters with pagination (Sequential) ---
      let currentChaptersUrl = new URL(allUrl, this.site).toString();
      let hasMorePages = true;

      while (hasMorePages) {
        const chaptersBody = await fetchText(
          currentChaptersUrl,
          this.fetchOptions,
        );
        const chaptersLoadedCheerio = parseHTML(chaptersBody);

        // Extract chapters from the current page
        chaptersLoadedCheerio('dl.panel-chapterlist dd').each((i, el) => {
          const chapterUrl = chaptersLoadedCheerio(el).find('a').attr('href');
          const chapterName = chaptersLoadedCheerio(el).find('a').text().trim();
          if (chapterUrl) {
            // Ensure relative path, handle both absolute/relative cases
            const relativeChapterUrl = chapterUrl.startsWith('http')
              ? chapterUrl.replace(this.site, '')
              : chapterUrl;
            // Avoid duplicates if the same chapter appears on multiple pages (unlikely but safe)
            if (!chapters.some(chap => chap.path === relativeChapterUrl)) {
              chapters.push({
                name: chapterName,
                path: relativeChapterUrl,
              });
            }
          }
        });

        // Find the link to the next page using the text "下一页"
        const nextPageLinkElement = chaptersLoadedCheerio(
          'div.listpage a.onclick',
        ).filter((i, el) =>
          chaptersLoadedCheerio(el).text().includes('下一页'),
        );
        const nextPageLink = nextPageLinkElement.attr('href');

        if (nextPageLink && nextPageLink !== 'javascript:void(0);') {
          // Check if it's a valid relative or absolute URL before creating the URL object
          try {
            const absoluteNextPageUrl = new URL(
              nextPageLink,
              this.site,
            ).toString();
            if (absoluteNextPageUrl === currentChaptersUrl) {
              // Break if the next page URL is the same as the current one (prevents infinite loops)
              hasMorePages = false;
            } else {
              currentChaptersUrl = absoluteNextPageUrl;
            }
          } catch (e) {
            // Handle cases where the link might be invalid or unexpected
            console.warn(`Invalid next page link found: ${nextPageLink}`);
            hasMorePages = false;
          }
        } else {
          hasMorePages = false;
        }
      }
      // --- End: Fetch chapters with pagination (Sequential) ---
    } else {
      // Fallback if no "all chapters" link is found
      loadedCheerio(
        'div.panel.hidden-xs > dl.panel-chapterlist:nth-child(2) > dd',
      ).each((i, el) => {
        const chapterUrl = loadedCheerio(el).find('a').attr('href');
        const chapterName = loadedCheerio(el).find('a').text().trim();
        if (chapterUrl) {
          const relativeChapterUrl = chapterUrl.startsWith('http')
            ? chapterUrl.replace(this.site, '')
            : chapterUrl;
          chapters.push({
            name: chapterName,
            path: relativeChapterUrl,
          });
        }
      });
    }

    // Remove duplicates just in case (though less likely with sequential fetching)
    const uniqueChapters = chapters.filter(
      (chapter, index, self) =>
        index === self.findIndex(c => c.path === chapter.path),
    );

    novel.chapters = uniqueChapters;

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const chapterUrl = new URL(chapterPath, this.site).toString();
    const body = await fetchText(chapterUrl, this.fetchOptions); // Header hinzugefügt

    const loadedCheerio = parseHTML(body);

    const chapterTitle = loadedCheerio('h1').text().trim();

    // Собираем все <p> из #chaptercontent
    let rawHtml = loadedCheerio('#chaptercontent p')
      .map((i, el) => {
        const text = loadedCheerio(el).text().trim();
        if (!text || text.includes('69书吧')) return ''; // фильтруем пустые строки и рекламу
        // автоматически <h1> для "Глава N"
        if (/^Глава\s+\d+/i.test(text)) return `<h1>${text}</h1>`;
        return `<p>${text}</p>`;
      })
      .get()
      .join('');

    rawHtml = `<h1>${chapterTitle}</h1>` + '🐼<br>' + rawHtml;

    let translatedChapterText = '';
    if (rawHtml.trim()) {
      translatedChapterText = await translateHtmlByLinePlain(rawHtml, 'ru');
    } else {
      translatedChapterText = ''; // or keep as is, no translation
    }

    return translatedChapterText.trim();
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];

    const searchUrl = `${this.site}/search`;
    const formData = new FormData();
    formData.append('searchkey', searchTerm);

    const searchOptions = {
      ...this.fetchOptions,
      method: 'post',
      body: formData,
      headers: {
        ...this.fetchOptions.headers,
      },
    };

    const body = await fetchText(searchUrl, searchOptions);
    if (body === '')
      throw Error('Не удалось получить результаты поиска, проверьте сеть.');

    const loadedCheerio = parseHTML(body);

    const novels: Plugin.NovelItem[] = [];

    loadedCheerio('div.book-coverlist').each((i, el) => {
      const url = loadedCheerio(el).find('a.cover').attr('href');

      const novelName = loadedCheerio(el).find('h4.name').text().trim();
      const novelCover = loadedCheerio(el).find('a.cover > img').attr('src');

      if (!url) return;

      const novel = {
        name: novelName,
        cover: novelCover,
        path: url.replace(this.site, ''),
      };

      novels.push(novel);
    });

    return novels;
  }

  filters = {
    rank: {
      label: '排行榜',
      value: 'allvisit',
      options: [
        { label: '总排行榜', value: 'allvisit' },
        { label: '月排行榜', value: 'monthvisit' },
        { label: '周排行榜', value: 'weekvisit' },
        { label: '日排行榜', value: 'dayvisit' },
        { label: '收藏榜', value: 'goodnum' },
        { label: '字数榜', value: 'words' },
        { label: '推荐榜', value: 'allvote' },
        { label: '新书榜', value: 'postdate' },
        { label: '更新榜', value: 'lastupdate' },
      ],
      type: FilterTypes.Picker,
    },
    sort: {
      label: '分类',
      value: 'none',
      options: [
        { label: '无', value: 'none' },
        { label: '全部', value: 'all' },
        { label: '玄幻', value: 'xuanhuan' },
        { label: '仙侠', value: 'xianxia' },
        { label: '都市', value: 'dushi' },
        { label: '历史', value: 'lishi' },
        { label: '游戏', value: 'youxi' },
        { label: '科幻', value: 'kehuan' },
        { label: '灵异', value: 'kongbu' },
        { label: '言情', value: 'nvsheng' },
        { label: '其它', value: 'qita' },
      ],
      type: FilterTypes.Picker,
    },
  } satisfies Filters;
}

export default new Shu69();

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
    return new URL(relativeUrl, baseUrl).href;
  } catch {
    return undefined;
  }
};

//This is the copy of @libs/googleTranslate.ts
// Разбиваем HTML на логические абзацы
function splitParagraphs(html: string): string[] {
  const text = html
    .replace(/<\/p\s*>/gi, '\n')
    .replace(/<p[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\u3000/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return text
    .split(/\n+/)
    .map(p => p.trim())
    .filter(Boolean);
}

// Делим длинный абзац на части по знакам препинания или словам
function splitLongParagraph(p: string, max = 1000): string[] {
  if (p.length <= max) return [p];

  const parts = p
    .split(/([。.!?！？])/g)
    .reduce((acc: string[], cur) => {
      if (!acc.length || (acc[acc.length - 1] + cur).length > max)
        acc.push(cur);
      else acc[acc.length - 1] += cur;
      return acc;
    }, [])
    .flatMap(chunk => {
      if (chunk.length <= max) return [chunk];
      const words = chunk.split(/\s+/);
      const res: string[] = [];
      let cur = '';
      for (const w of words) {
        if ((cur + ' ' + w).trim().length > max) {
          if (cur) res.push(cur.trim());
          cur = w;
        } else cur = (cur + ' ' + w).trim();
      }
      if (cur) res.push(cur.trim());
      return res;
    });

  return parts;
}

// Создаём готовые к переводу куски
export function makeChunksFromHTML(html: string, max = 1000): string[] {
  return splitParagraphs(html).flatMap(p => splitLongParagraph(p, max));
}

// Перевод одного куска через Google Translate
async function translateChunk(chunk: string, lang: string): Promise<string> {
  const res = await fetch(
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=${lang}&dt=t&q=${encodeURIComponent(chunk)}`,
  );
  if (!res.ok) throw new Error(`Translate failed ${res.status} ${chunk}`);
  const data = await res.json();
  return data[0].map((d: any) => d[0]).join('');
}

// Основная функция перевода
export async function translate(text: string, lang: string): Promise<string> {
  if (text.length < 2) return text;
  const chunks = makeChunksFromHTML(text, 1000);
  const translations: string[] = [];
  for (const c of chunks) {
    translations.push(await translateChunk(c, lang));
    await new Promise(r => setTimeout(r, 500));
  }
  return translations.map(p => `<p>${p}</p>`).join('\n');
}

async function translateHtmlByLinePlain(html: string, targetLang: string) {
  // 1️⃣ Normalize tags: remove all attributes
  html = html.replace(/<(\w+)[^>]*>/g, '<$1>');

  // 2️⃣ Split into "lines" based on closing tags or <br>
  // Use closing </p>, </h1>-</h4>, </li> as line breaks; <br> as line break
  const lineBreakTags = [
    '</p>',
    '</h1>',
    '</h2>',
    '</h3>',
    '</h4>',
    '</li>',
    '<br>',
  ];

  let lines: { tag: string; text: string; parentTag?: string }[] = [];

  // Split by line break tags, keeping the tag
  const regex = new RegExp(`(${lineBreakTags.join('|')})`, 'gi');
  const parts = html.split(regex).filter(Boolean);

  for (let i = 0; i < parts.length; i += 2) {
    const text = (parts[i] || '').replace(/<[^>]+>/g, '').trim();
    const tag = (parts[i + 1] || '').toLowerCase();

    if (!text && !tag) continue;

    if (tag === '</li>') {
      if (text) lines.push({ tag: 'LI', text, parentTag: 'UL' });
    } else if (tag.startsWith('</h')) {
      if (text)
        lines.push({ tag: tag.replace(/[<>]/g, '').toUpperCase(), text }); // H1-H4
      lines.push({ tag: 'BR', text: '' });
    } else if (tag === '</p>') {
      if (text) lines.push({ tag: 'P', text });
    } else if (tag === '<br>') {
      if (text) lines.push({ tag: 'P', text });
    } else if (text) {
      lines.push({ tag: 'P', text });
    }
  }

  const SEPARATOR = ' 😀 '; // Unique separator unlikely to appear in text

  // 3️⃣ Extract plain text for translation
  const plainText = lines
    .map(n => (n.tag === 'BR' ? '' : n.text))
    .join(SEPARATOR);

  // 4️⃣ Translate plain text
  let translatedText = await translateAutoHotkeyStyle(plainText, targetLang);
  // Remove the outer brackets and the second array
  translatedText = translatedText
    .replace(/^\[\[\"/, '') // remove opening [["
    .replace(/\"\],\s*\[\".*\"\]\]$/, ''); // remove ",["ln"]]

  const translatedLines = translatedText.split(SEPARATOR);

  // 5️⃣ Rebuild HTML with tags
  let htmlResult = '';

  for (let i = 0; i < lines.length; i++) {
    const node = lines[i];
    const line = translatedLines[i] || '';

    if (/^Глава\s+\d+/i.test(line)) {
      htmlResult += `<h1>${line}</h1>`;
    } else if (node.tag === 'BR') {
      htmlResult += '<br>';
    } else if (node.tag === 'LI') {
      htmlResult += `<ul><li>${line}</li></ul>`;
    } else if (node.tag.startsWith('H')) {
      htmlResult += `<${node.tag}>${line}</${node.tag}>`;
    } else {
      htmlResult += `<p>${line}</p>`;
    }
  }

  return htmlResult;
}

export async function translateAutoHotkeyStyle(
  text: string,
  lang: string,
): Promise<string> {
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

  // === 1️⃣ POST to translateHtml (same as AHK, but response ignored) ===
  const postPayload = JSON.stringify([[[text], 'auto', lang], 'wt_lib']);

  let htext = '';
  // === 2️⃣ Fetch with error handling ===
  try {
    const response = await fetch(
      'https://translate-pa.googleapis.com/v1/translateHtml',
      {
        method: 'POST',
        headers: {
          'User-Agent': userAgent,
          'X-Goog-API-Key': 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520',
          'Content-Type': 'application/json+protobuf',
        },
        body: postPayload,
      },
    );

    // Check if server actually responded with success
    if (!response.ok) {
      htext = `HTTP error ${response.status}: ${response.statusText}`;
      const text = await response.text(); // optional, to see the error body
      htext += '\nError body:' + text;
      return htext;
    }

    // If all good
    htext = await response.text();
  } catch (err) {
    // Network errors, DNS failures, etc.
    htext = 'Fetch failed:' + err;
  }

  return htext;
}
