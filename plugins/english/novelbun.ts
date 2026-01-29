import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';

const BASE_URL = 'https://novelbun.com/';

function makeAbsolute(path: string | undefined): string | undefined {
  if (!path) return undefined;
  if (path.startsWith('http')) return path;
  if (path.startsWith('//')) return 'https:' + path;
  return BASE_URL + path.replace(/^\//, '');
}

class NovelBunPlugin implements Plugin.PluginBase {
  id = 'novelbun';
  name = 'Novel Bun';
  icon = 'src/en/novelbun/favicon.png'; // ← add real favicon path if exists
  site = BASE_URL;
  version = '0.1.0';

  // No search implemented (as per your info)
  async searchNovels(): Promise<Plugin.NovelItem[]> {
    return [];
  }

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return []; // assuming no pagination on home

    const url = BASE_URL;
    const res = await fetchApi(url);
    if (!res.ok) return [];

    const html = await res.text();
    const $ = parseHTML(html);

    const novels: Plugin.NovelItem[] = [];

    $('ul.novel-card-grid li.novel-card').each((_, el) => {
      const $li = $(el);

      const $a = $li.find('a').first();
      const path = $a.attr('href')?.trim();
      if (!path) return;

      const title = $li.find('h2').first().text().trim();
      if (!title) return;

      let cover =
        $li.find('img').attr('src') ||
        $li.find('img').attr('data-src') ||
        defaultCover;

      cover = makeAbsolute(cover) || defaultCover;

      novels.push({
        name: title,
        path,
        cover,
      });
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = makeAbsolute(novelPath);
    if (!url) throw new Error('Invalid novel path');

    const res = await fetchApi(url);
    if (!res.ok) throw new Error(`Cannot load novel page: ${res.status}`);

    const $ = parseHTML(await res.text());

    // Title
    const name = $('main h1').first().text().trim() || 'Untitled';

    // Cover
    let cover =
      $('div.novel-container img').first().attr('src') || defaultCover;
    cover = makeAbsolute(cover) || defaultCover;

    // Metadata block
    let author = '';
    let altTitles = '';
    let status = '';
    status = NovelStatus.Unknown;

    $('div.novel-container h2:contains("Details")')
      .next('div')
      .find('> span, > div')
      .each((_, el) => {
        const $el = $(el);
        const key = $el
          .find('strong')
          .first()
          .text()
          .trim()
          .replace(':', '')
          .trim()
          .toLowerCase();
        const value = $el.clone().find('strong').remove().end().text().trim();

        if (!value) return;

        if (key.includes('author')) {
          author = value;
        } else if (key.includes('alternate') || key.includes('alt title')) {
          altTitles = value;
        } else if (key.includes('status')) {
          const s = value.toLowerCase();
          if (s.includes('ongoing') || s.includes('active'))
            status = NovelStatus.Ongoing;
          else if (s.includes('complete') || s.includes('finished'))
            status = NovelStatus.Completed;
          else if (s.includes('hiatus')) status = NovelStatus.OnHiatus;
          else if (s.includes('drop') || s.includes('cancel'))
            status = NovelStatus.Cancelled;
        }
      });

    const fullName = altTitles ? `${name} / ${altTitles}` : name;

    // Summary
    let summary = '';
    const $desc = $('#editdescription');
    if ($desc.length) {
      summary = $desc
        .find('p')
        .map((_, p) => $(p).text().trim())
        .get()
        .filter(Boolean)
        .join('\n\n');
    }
    if (!summary) {
      // fallback
      summary = $('h2:contains("Summary")').next('div').text().trim();
    }

    // Genres
    const genres: string[] = [];
    $('h2:contains("Genres")')
      .next('div')
      .find('a.chip')
      .each((_, a) => {
        const g = $(a).text().trim();
        if (g) genres.push(g);
      });

    // Chapters link → assuming chapters are on separate page
    let chaptersUrl = $('div.novel-container a')
      .filter((_, a) => /chapters?/i.test($(a).text()))
      .attr('href');
    if (!chaptersUrl) {
      // fallback: assume /chapters appended
      chaptersUrl = novelPath.replace(/\/$/, '') + '/chapters';
    }
    chaptersUrl = makeAbsolute(chaptersUrl);

    // Load chapters page
    const chapters: Plugin.ChapterItem[] = [];
    if (chaptersUrl) {
      const chRes = await fetchApi(chaptersUrl);
      if (chRes.ok) {
        const $ch = parseHTML(await chRes.text());

        // All chapters section (preferred over Recent Chapters)
        $ch('h2:contains("All Chapters")')
          .next('ul.link-card-grid')
          .find('li.link-card a')
          .each((_, a) => {
            const $a = $(a);
            const chPath = $a.attr('href')?.trim();
            if (!chPath) return;

            let chName = $a.find('h2').first().text().trim();
            // remove arrow if present
            chName = chName.replace(/→\s*/g, '').trim();

            const dateStr = $a.find('p').first().text().trim();

            let releaseTime: string | undefined;
            if (dateStr) {
              // Sep 21, 2024 → 2024-09-21
              try {
                const [mon, day, year] = dateStr.split(/[\s,]+/);
                const monthMap: Record<string, string> = {
                  jan: '01',
                  feb: '02',
                  mar: '03',
                  apr: '04',
                  may: '05',
                  jun: '06',
                  jul: '07',
                  aug: '08',
                  sep: '09',
                  oct: '10',
                  nov: '11',
                  dec: '12',
                };
                const m = monthMap[mon.toLowerCase().slice(0, 3)] || '01';
                releaseTime = `${year}-${m}-${day.padStart(2, '0')}`;
              } catch {
                releaseTime = dateStr;
              }
            }

            chapters.push({
              name: chName,
              path: chPath,
              releaseTime,
            });
          });
      }
    }

    return {
      path: novelPath,
      name: fullName,
      cover,
      author: author || undefined,
      summary,
      genres: genres.join(', '),
      status,
      chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = makeAbsolute(chapterPath);
    if (!url) throw new Error('Invalid chapter path');

    const res = await fetchApi(url);
    if (!res.ok) throw new Error('Cannot load chapter');

    const $ = parseHTML(await res.text());

    // Chapter title (usually in <p> after h1)
    let title = $('main p').first().text().trim();
    if (!title) {
      title = $('main h1').next('p').text().trim() || 'Chapter';
    }

    // Main content – most likely the big <div> after styles/support-popup/etc.
    let content = '';

    // Try the most probable container
    const $body = $('main > div')
      .filter((_, el) => {
        const txt = $(el).text().trim();
        return txt.length > 300; // heuristic: real content is long
      })
      .first();

    if ($body.length) {
      content = $body.html()?.trim() || '';
    } else {
      // fallback: take everything after first few blocks
      content = $('main')
        .contents()
        .slice(5) // skip h1, a, p, style...
        .not('.support-popup, .hidden, noscript')
        .map((_, el) => $.html(el))
        .get()
        .join('\n')
        .trim();
    }

    // Final formatting
    return `<h1>${title}</h1>\n🐼<br>\n${content}`;
  }
}

export default new NovelBunPlugin();
