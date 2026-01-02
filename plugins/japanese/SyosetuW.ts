import { load as loadCheerio } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

class syosetuWOMEN18Plugin implements Plugin.PluginBase {
  id = 'syosetuWOMEN18';
  name = 'Syosetu 18+ ♀ (ムーンライトノベルズ)';
  icon = 'src/jp/syosetu/iconW.png'; // reuse or change if needed
  site = 'https://mnlt.syosetu.com/';
  novelPrefix = 'https://novel18.syosetu.com/';
  popularPrefix = 'https://mnlt.syosetu.com/';
  searchPrefix = 'https://mnlt.syosetu.com/search/';
  version = '2.0.1';
  headers = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  };

  // Parse Japanese date string "2025年 12月25日 18時28分" to "YYYY-MM-DD"
  parseJapaneseDate(dateStr: string): string {
    // Remove time part if present
    const datePart = dateStr.split(' ')[0]; // "2025年 12月25日"

    // Extract year, month, day using regex
    const match = datePart.match(/(\d{4})年\s*(\d{1,2})月(\d{1,2})日/);

    if (!match) return ''; // invalid format

    const year = match[1].padStart(4, '0');
    const month = match[2].padStart(2, '0');
    const day = match[3].padStart(2, '0');

    return `${year}-${month}-${day}`;
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return []; // only one page available
    const url = `${this.popularPrefix}rank/list/type/daily_total/`;
    const html = await (await fetchApi(url, { headers: this.headers })).text();
    const $ = loadCheerio(html);

    const novels: Plugin.NovelItem[] = [];
    $('.rank_h').each((_, e) => {
      const a = $(e).find('a').first();
      const href = a.attr('href');
      const name = a.text().trim();
      if (href && name) {
        novels.push({
          name,
          path: href, //Полная ссылка
          cover: defaultCover,
        });
      }
    });
    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const novelIndex = novelPath.replace(this.novelPrefix, '');
    //https://novel18.syosetu.com/n9622ln/ -> n9622ln/
    const infoURL = `${this.novelPrefix}novelview/infotop/ncode/${novelIndex}`;
    const infoHTML = await (
      await fetchApi(infoURL, { headers: this.headers })
    ).text();
    const info$ = loadCheerio(infoHTML);

    let status = 'Unknown';
    status = NovelStatus.Unknown;

    let title = info$('h1.p-infotop-title a').text().trim();
    let chapters: Plugin.ChapterItem[] = [];

    const typeSpan = info$('.p-infotop-type__type');

    //Check if this is oneshot (novel with single chapter)
    if (typeSpan.hasClass('p-infotop-type__type--short')) {
      status = NovelStatus.Completed;
      //There is only one chapter
      chapters.push({
        name: 'Oneshot',
        path: novelPath,
      });
    } else {
      //It is multi-chapter novel
      if (typeSpan.hasClass('p-infotop-type__type--serialized')) {
        status = NovelStatus.Ongoing;
      } else if (typeSpan.hasClass('p-infotop-type__type--completed')) {
        status = NovelStatus.Completed;
      } else status = NovelStatus.Unknown;

      //Get chapters list
      const url = makeAbsolute(novelPath, this.novelPrefix) || novelPath;
      const html = await (
        await fetchApi(url, { headers: this.headers })
      ).text();
      const $ = loadCheerio(html);

      let currentPart: string | null = null;

      $('.p-eplist > *').each((_, el) => {
        const elem = $(el);
        // Detect part/chapter title
        if (elem.hasClass('p-eplist__chapter-title')) {
          currentPart = elem.text().trim();
        }
        // Detect individual chapter
        if (elem.hasClass('p-eplist__sublist')) {
          const a = elem.find('a.p-eplist__subtitle');
          const href = a.attr('href');
          let name = a.text().trim();
          if (currentPart) {
            name = `${currentPart} - ${name}`; // or just name if no prefix wanted
          }
          // Get date
          const updateDiv = elem.find('.p-eplist__update');
          let dateStr = updateDiv
            .clone()
            .children()
            .remove()
            .end()
            .text()
            .trim(); // remove span, get text node
          dateStr = dateStr.split(' ')[0]; // YYYY/MM/DD
          // Check for revision span
          const revSpan = updateDiv.find('span[title]');
          if (revSpan.length) {
            const title = revSpan.attr('title') || '';
            const match = title.match(/(\d{4}\/\d{2}\/\d{2} \d{2}:\d{2})/);
            if (match) {
              dateStr = match[1].split(' ')[0];
            }
          }
          const releaseTime = dateStr.replace(/\//g, '-');

          chapters.push({
            name,
            path: href || '',
            releaseTime,
          });
        }
      });
    }

    let summary = '';
    let author = '';
    let releaseTime = undefined;

    info$('.p-infotop-data dt').each((i, dt) => {
      const title = info$(dt).text().trim(); // e.g. "Краткое содержание"
      const valueEl = info$(dt).next('dd'); // corresponding <dd>
      let value = valueEl.text().trim(); // base text

      // Clean extra notes like "*Требуется вход в систему"
      value = value.replace(/\*.*$/g, '').trim();

      // Special handling
      if (title.includes('あらすじ')) {
        //Краткое содержание
        summary =
          valueEl
            .html() // keep <br> for lines
            ?.replace(/<br>/gi, '\n') // or keep as is
            .trim() || '';
      } else if (title.includes('作者名')) {
        //Имя автора
        author = valueEl.find('a').text().trim() || value;
      } else if (title.includes('掲載日')) {
        releaseTime = this.parseJapaneseDate(value); //This would be used only for oneshot novels
      }
    });

    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: title,
      author,
      status,
      cover: defaultCover,
      summary,
      genres: '',
      chapters,
    };

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = makeAbsolute(chapterPath, this.novelPrefix) || chapterPath;
    const html = await (await fetchApi(url, { headers: this.headers })).text();
    const $ = loadCheerio(html);

    const title = $('h1.p-novel__title').text().trim();

    // Clean all chapter text blocks
    let cleanedLines: string[] = [];
    $('.js-novel-text.p-novel__text').each((_, block) => {
      const blockHtml = $(block).html() || '';

      // Parse block safely
      const $block = loadCheerio(`<div>${blockHtml}</div>`);

      $block('p').each((_, p) => {
        const text = $(p).text().trim();
        if (text) {
          cleanedLines.push(`<p>${text}</p>`);
        } else {
          cleanedLines.push('<br>');
        }
      });
    });

    const content = cleanedLines.join('\n').trim();

    let rawHtml = '<h1>' + title + '</h1>' + '🐼<br>' + content;
    let chapterText = '';

    if (rawHtml.trim()) {
      chapterText = await translateHtmlByLinePlain(rawHtml, 'ru');
    } else {
      chapterText = ''; // or keep as is, no translation
    }

    return chapterText.trim();
  }

  // Updated searchNovels for novel18.syosetu.com
  async searchNovels(
    searchTerm: string,
    pageNo?: number,
  ): Promise<Plugin.NovelItem[]> {
    const url = `${this.searchPrefix}search/?word=${encodeURIComponent(searchTerm)}&p=${pageNo || 1}`;
    const html = await (await fetchApi(url, { headers: this.headers })).text();
    const $ = loadCheerio(html);

    const novels: Plugin.NovelItem[] = [];

    $('.searchkekka_box').each((_, box) => {
      const a = $(box).find('.novel_h a.tl').first();
      const href = a.attr('href');
      const name = a.text().trim();

      if (href && name) {
        novels.push({
          name,
          path: href,
          cover: defaultCover,
        });
      }
    });

    return novels;
  }
}
export default new syosetuWOMEN18Plugin();

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
