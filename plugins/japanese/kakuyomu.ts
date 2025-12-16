import { fetchText } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { Filters, FilterTypes } from '@libs/filterInputs';
import { load as loadCheerio } from 'cheerio';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class KakuyomuPlugin implements Plugin.PluginBase {
  id = 'kakuyomu';
  name = 'kakuyomu';
  icon = 'src/jp/kakuyomu/icon.png';
  site = 'https://kakuyomu.jp';
  version = '1.0.0';
  filters = {
    genre: {
      type: FilterTypes.Picker,
      label: 'Genre',
      options: [
        { label: '総合', value: 'all' },
        { label: '異世界ファンタジー', value: 'fantasy' },
        { label: '現代ファンタジー', value: 'action' },
        { label: 'SF', value: 'sf' },
        { label: '恋愛', value: 'love_story' },
        { label: 'ラブコメ', value: 'romance' },
        { label: '現代ドラマ', value: 'drama' },
        { label: 'ホラー', value: 'horror' },
        { label: 'ミステリー', value: 'mystery' },
        { label: 'エッセイ・ノンフィクション', value: 'nonfiction' },
        { label: '歴史・時代・伝奇', value: 'history' },
        { label: '創作論・評論', value: 'criticism' },
        { label: '詩・童話・その他', value: 'others' },
      ],
      value: 'all',
    },
    period: {
      type: FilterTypes.Picker,
      label: 'Period',
      options: [
        { label: '累計', value: 'entire' },
        { label: '日間', value: 'daily' },
        { label: '週間', value: 'weekly' },
        { label: '月間', value: 'monthly' },
        { label: '年間', value: 'yearly' },
      ],
      value: 'entire',
    },
  } satisfies Filters;
  imageRequestInit?: Plugin.ImageRequestInit | undefined = undefined;

  //flag indicates whether access to LocalStorage, SesesionStorage is required.
  webStorageUtilized?: boolean;

  async popularNovels(
    pageNo: number,
    { filters }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const url = new URL(
      `/rankings/${filters.genre.value}/${filters.period.value}`,
      this.site,
    );
    if (pageNo > 1) {
      url.searchParams.set('page', pageNo.toString());
    }
    const html = await fetchText(url.toString());
    const $ = loadCheerio(html);
    const novels: Plugin.NovelItem[] = [];

    $('.widget-media-genresWorkList-right > .widget-work').each((_, elem) => {
      const anchor = $(elem).find('a.widget-workCard-titleLabel');
      const path = anchor.attr('href');
      if (!path) return;
      const name = anchor.text();
      novels.push({
        name,
        path,
        cover: defaultCover,
      });
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = new URL(novelPath, this.site);
    const html = await fetchText(url.toString());
    const $ = loadCheerio(html);

    const json = JSON.parse(
      $('script#__NEXT_DATA__[type="application/json"]').html() || '{}',
    );
    const apolloState = json?.props?.pageProps?.__APOLLO_STATE__ ?? {};

    const work = Object.values(apolloState).find(
      v =>
        typeof v === 'object' &&
        v !== null &&
        '__typename' in v &&
        v.__typename === 'Work' &&
        'id' in v &&
        v.id === novelPath.replace('/works/', ''),
    ) as Work;

    const author = Object.values(apolloState).find(
      v =>
        typeof v === 'object' &&
        v !== null &&
        '__typename' in v &&
        v.__typename === 'UserAccount' &&
        'id' in v &&
        v.id === work.author.__ref.replace('UserAccount:', ''),
    ) as UserAccount;

    const chapters = Object.values(apolloState).filter(v => {
      if (
        typeof v === 'object' &&
        v !== null &&
        '__typename' in v &&
        v.__typename === 'Chapter'
      ) {
        return true;
      }
    }) as Chapter[];

    const tableOfContentsChapter = Object.values(apolloState).filter(v => {
      if (
        typeof v === 'object' &&
        v !== null &&
        '__typename' in v &&
        v.__typename === 'TableOfContentsChapter'
      ) {
        return true;
      }
    }) as TableOfContentsChapter[];

    const episodes = Object.values(apolloState).filter(v => {
      if (
        typeof v === 'object' &&
        v !== null &&
        '__typename' in v &&
        v.__typename === 'Episode'
      ) {
        return true;
      }
    }) as Episode[];

    const joinChapters: {
      chapter: Chapter | undefined;
      episode: Episode;
    }[] = episodes.map(v => {
      const chapter = tableOfContentsChapter.find(c =>
        c.episodeUnions.some(e => e.__ref === `Episode:${v.id}`),
      )?.chapter;
      return {
        chapter: chapters.find(
          c => c.id === chapter?.__ref.replace('Chapter:', ''),
        ),
        episode: v,
      };
    });

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: work.title,
      cover: work.adminCoverImageUrl ?? defaultCover,
      genres: (work?.tagLabels ?? []).join(','),
      author: author?.activityName,
      status:
        work.serialStatus === 'COMPLETED'
          ? NovelStatus.Completed
          : NovelStatus.Ongoing,
      summary: await translate(work.introduction, 'ru'),
      chapters: joinChapters.map(v => {
        return {
          name: v.chapter?.title
            ? `${v.chapter?.title} - ${v.episode?.title}`
            : v.episode?.title ?? '',
          path: `${novelPath}/episodes/${v.episode?.id}`,
          releaseTime: new Date(v.episode?.publishedAt ?? 0).toISOString(),
        };
      }),
    };

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = new URL(chapterPath, this.site);
    const html = await fetchText(url.toString());
    const $ = loadCheerio(html);
    const chapterTitle = $('.chapterTitle').text() ?? '';
    const episodeTitle = $('.widget-episodeTitle').html() ?? '';
    const episodeBodyRaw = $('.widget-episodeBody').html() ?? '';
    let episodeBody = '';
    if (episodeBodyRaw) {
      episodeBody = await translateHtmlByLinePlain(episodeBodyRaw, 'ru');
    } else {
      episodeBody = ''; // or keep as is, no translation
    }
    const chapterText = `
    <div>
      ${chapterTitle ? `<h1>${chapterTitle}</h1>` : ''}
      <h2>${episodeTitle}</h2>
    </div>
    <p><br><br></p>
    ${episodeBody}`;
    return chapterText;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const url = new URL('/search', this.site);
    url.searchParams.set('q', searchTerm);
    if (pageNo > 1) {
      url.searchParams.set('page', pageNo.toString());
    }
    const html = await fetchText(url.toString());
    const $ = loadCheerio(html);

    const json = JSON.parse(
      $('script#__NEXT_DATA__[type="application/json"]').html() || '{}',
    );
    const works = Object.values(
      json?.props?.pageProps?.__APOLLO_STATE__ ?? {},
    ).filter(v => {
      if (
        typeof v === 'object' &&
        v !== null &&
        '__typename' in v &&
        v.__typename === 'Work'
      ) {
        return true;
      }
    }) as Work[];

    const novels: Plugin.NovelItem[] = works.map(v => ({
      name: v.title ?? '',
      path: `/works/${v.id}`,
      cover: v.adminCoverImageUrl ?? defaultCover,
    }));

    return novels;
  }
}

export default new KakuyomuPlugin();

type Work = {
  id: string;
  title: string;
  serialStatus: string;
  tagLabels: string[];
  introduction: string;
  adminCoverImageUrl?: string;
  author: {
    __ref: string;
  };
};

type UserAccount = {
  activityName: string;
};

type Chapter = {
  id: string;
  title: string;
};

type Episode = {
  title: string;
  id: string;
  publishedAt: string;
};

type TableOfContentsChapter = {
  chapter: {
    __ref: string;
  };
  episodeUnions: {
    __ref: string;
  }[];
};

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
    `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=${lang}&dt=t&q=${encodeURIComponent(chunk)}`,
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

async function translateHtmlByLinePlain(
  html: string,
  targetLang: string,
  sourceLang: string = 'auto', // 👈 по умолчанию auto
) {
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

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (lineBreakTags.includes(part.toLowerCase())) {
      // just a tag, skip or mark break
      continue;
    }
    const next =
      parts[i + 1] && lineBreakTags.includes(parts[i + 1].toLowerCase())
        ? parts[i + 1].toLowerCase()
        : '';

    const text = part.replace(/<[^>]+>/g, '').trim();
    if (!text) continue;

    if (next === '</li>') {
      lines.push({ tag: 'LI', text, parentTag: 'UL' });
    } else if (next.startsWith('</h')) {
      lines.push({ tag: next.replace(/[<>]/g, '').toUpperCase(), text });
      lines.push({ tag: 'BR', text: '' });
    } else if (next === '</p>') {
      lines.push({ tag: 'P', text });
    } else if (next === '<br>') {
      lines.push({ tag: 'P', text });
    } else {
      lines.push({ tag: 'P', text });
    }
  }

  const SEPARATOR = ' 😀 '; // Unique separator unlikely to appear in text

  // 3️⃣ Extract plain text for translation
  const plainText = lines
    .map(n => (n.tag === 'BR' ? '' : n.text))
    .join(SEPARATOR);

  // 4️⃣ Translate plain text (используем sourceLang)
  let translatedText = await translateAutoHotkeyStyle(
    plainText,
    targetLang,
    sourceLang,
  ); // Remove the outer brackets and the second array
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
  sourceLang: string = 'auto', // 👈 тоже по умолчанию auto
): Promise<string> {
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';

  // === 1️⃣ POST to translateHtml (same as AHK, but response ignored) ===
  const postPayload = JSON.stringify([[[text], sourceLang, lang], 'te_lib']);

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
