import { load as parseHTML } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@/types/plugin';
import { defaultCover } from '@libs/defaultCover';
import { NovelStatus } from '@libs/novelStatus';
import { storage } from '@libs/storage';

class bcatranslationPlugin implements Plugin.PluginBase {
  id = 'bcatranslation';
  name = 'Bcat00 Novel';
  icon = 'src/en/bcatranslation/favicon.png'; // create if needed
  site = 'https://bcatranslation.com/';
  version = '1.0.1';

  hidePremium = storage.get('hidePremium') ?? false;
  pluginSettings = {
    hidePremium: {
      value: '',
      label: 'Hide premium/coin chapters',
      type: 'Switch',
    },
  };

  async popularNovels(pageNo: number): Promise<Plugin.NovelItem[]> {
    if (pageNo > 1) return [];

    const url = this.site;
    const res = await fetchApi(url);
    if (!res.ok) return [];

    const $ = parseHTML(await res.text());

    const novels: Plugin.NovelItem[] = [];

    $(
      'section.rr-section.rr-latest-series div.rr-list.rr-series-list article.rr-card.rr-series-card',
    ).each((_i, el) => {
      const $card = $(el);

      const $link = $card.find('div.rr-thumb a').first();
      const path = $link.attr('href')?.trim() || '';
      if (!path) return;

      const cover = $link.find('img').attr('src')?.trim() || defaultCover;

      const title = $card.find('div.rr-meta h3.rr-title a').text().trim();

      if (title && path) {
        novels.push({
          name: title,
          path,
          cover: makeAbsolute(cover, this.site) || defaultCover,
        });
      }
    });

    return novels;
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    const url = makeAbsolute(novelPath, this.site);
    if (!url) throw new Error('Invalid novel path');

    const res = await fetchApi(url);
    if (!res.ok) throw new Error(`Failed to load novel: ${res.status}`);

    const $ = parseHTML(await res.text());

    // Title
    const name = $('div.post-title h1').text().trim() || 'Untitled';

    // Cover
    const cover =
      $('div.manga-thumb div.summary_image a img').attr('src')?.trim() ||
      defaultCover;

    // Author
    let author = '';
    $('div.post-content div.author-row div.post-content_item').each(
      (_i, el) => {
        const $el = $(el);
        if (
          $el
            .find('div.summary-heading h5')
            .text()
            .trim()
            .toLowerCase()
            .includes('author')
        ) {
          author = $el.find('div.summary-content').text().trim();
        }
      },
    );

    // Status
    let status = '';
    status = NovelStatus.Unknown;
    $('div.post-content div.post-content_item').each((_i, el) => {
      const $el = $(el);
      if (
        $el.find('div.summary-heading h5').text().trim().toLowerCase() ===
        'status'
      ) {
        const st = $el.find('div.summary-content').text().trim().toLowerCase();
        if (st.includes('ongoing') || st.includes('on going')) {
          status = NovelStatus.Ongoing;
        } else if (st.includes('completed')) {
          status = NovelStatus.Completed;
        } else if (st.includes('cancelled') || st.includes('dropped')) {
          status = NovelStatus.Cancelled;
        } else if (st.includes('on hold') || st.includes('hiatus')) {
          status = NovelStatus.OnHiatus;
        }
      }
    });

    // Summary
    const summaryParts: string[] = [];
    $('div.post-content div.description-summary div.summary__content p').each(
      (_i, p) => {
        const text = $(p).text().trim();
        if (text) summaryParts.push(text);
      },
    );
    const summary = summaryParts.join('\n\n').trim();

    // Chapters
    const chapters: Plugin.ChapterItem[] = [];

    const today = new Date();
    const todayStr = today.toISOString().split('T')[0];

    $('ul.main li').each((_i, li) => {
      const $li = $(li);

      const $a = $li.find('a').first();
      const chapterPath = $a.attr('href')?.trim() || '';
      if (!chapterPath) return;

      let chapterName = $a.text().trim();
      if (!chapterName) return;

      // Premium check
      const $coin = $li.find('span.coin');
      const isPremium =
        $coin.hasClass('free') === false &&
        $coin.find('i.fas.fa-coins').length > 0;
      if (isPremium && this.hidePremium) return;

      if (isPremium) {
        chapterName = `🔒 ${chapterName}`;
      }

      // Release date approximate parsing
      let releaseTime: string | undefined = undefined;
      const $date = $li.find('span.chapter-release-date');
      const dateText = $date.text().trim().toLowerCase();

      if (dateText) {
        if (/hour|hours|minute|minutes|second|seconds/.test(dateText)) {
          releaseTime = todayStr;
        } else if (/day|days/.test(dateText)) {
          const match = dateText.match(/(\d+)\s*(day|days)/);
          if (match) {
            const daysAgo = parseInt(match[1], 10);
            const d = new Date(today);
            d.setDate(d.getDate() - daysAgo);
            releaseTime = d.toISOString().split('T')[0];
          }
        } else {
          // try to parse month name / date
          try {
            const possibleDate = new Date(dateText);
            if (!isNaN(possibleDate.getTime())) {
              releaseTime = possibleDate.toISOString().split('T')[0];
            }
          } catch {
            // leave undefined
          }
        }
      }

      chapters.push({
        name: chapterName,
        path: chapterPath,
        releaseTime,
      });
    });

    return {
      path: novelPath,
      name,
      cover: makeAbsolute(cover, this.site) || defaultCover,
      summary,
      author: author || undefined,
      status,
      chapters,
    };
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const url = makeAbsolute(chapterPath, this.site);
    if (!url) throw new Error('Invalid chapter path');

    const res = await fetchApi(url);
    if (!res.ok) throw new Error(`Failed to load chapter: ${res.status}`);

    const $ = parseHTML(await res.text());

    // Chapter title
    let title = $('h1#chapter-heading')
      .contents()
      .filter((_, el) => el.type === 'text')
      .text()
      .trim();

    if (!title) {
      title = $('h1#chapter-heading').text().trim() || 'Chapter';
    }

    // Content
    const contentParts: string[] = [];

    const $contentDiv = $('div.reading-content > div').first();
    if ($contentDiv.length) {
      $contentDiv.find('p').each((_i, p) => {
        const text = $(p).text().trim();
        if (text) {
          // If first paragraph looks like "Chapter N: Title"
          if (contentParts.length === 0 && /^chapter\s+\d+/i.test(text)) {
            title = text; // override title if better
          } else {
            contentParts.push(text);
          }
        }
      });
    }

    let html = `<h1>${title}</h1>\n🐼<br>\n\n`;
    if (contentParts.length > 0) {
      html += contentParts.map(p => `<p>${p}</p>`).join('\n');
    } else {
      html += '<p>(no content found)</p>';
    }

    return html;
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const query = encodeURIComponent(searchTerm.trim());
    const url = `${this.site}page/${pageNo}/?s=${query}&post_type=wp-manga`;

    const res = await fetchApi(url);
    if (!res.ok) return [];

    const $ = parseHTML(await res.text());

    const novels: Plugin.NovelItem[] = [];

    $('div.search-lists div.manga__item').each((_i, el) => {
      const $item = $(el);

      const $thumbA = $item
        .find('div.manga__thumb div.manga__thumb_item a')
        .first();
      const path = $thumbA.attr('href')?.trim() || '';
      if (!path) return;

      const cover = $thumbA.find('img').attr('src')?.trim() || defaultCover;

      const title = $item
        .find('div.manga__content div.manga__content_item div h2 a')
        .text()
        .trim();

      if (title && path) {
        novels.push({
          name: title,
          path,
          cover: makeAbsolute(cover, this.site) || defaultCover,
        });
      }
    });

    return novels;
  }
}

export default new bcatranslationPlugin();

// ──────────────────────────────────────────────
//  Helpers (already present in many plugins)
// ──────────────────────────────────────────────
const makeAbsolute = (
  relative: string | undefined,
  base: string,
): string | undefined => {
  if (!relative) return undefined;
  try {
    if (relative.startsWith('//')) return new URL(base).protocol + relative;
    if (relative.startsWith('http://') || relative.startsWith('https://'))
      return relative;

    const baseClean = base.endsWith('/') ? base.slice(0, -1) : base;
    const relClean = relative.startsWith('/') ? relative.slice(1) : relative;

    return new URL(relClean, baseClean + '/').href;
  } catch {
    return undefined;
  }
};
