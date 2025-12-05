import { CheerioAPI, load as loadCheerio, load } from 'cheerio';
import { fetchApi } from '@libs/fetch';
import { Plugin } from '@typings/plugin';
import { NovelStatus } from '@libs/novelStatus';
import { Filters } from '../../../src/libs/filterInputs';

type FictioneerOptions = {
  browsePage: string;
  lang?: string;
  versionIncrements?: number;
};

export type FictioneerMetadata = {
  id: string;
  sourceSite: string;
  sourceName: string;
  options: FictioneerOptions;
};

class FictioneerPlugin implements Plugin.PluginBase {
  id: string;
  name: string;
  icon: string;
  site: string;
  version: string;
  options: FictioneerOptions;
  filters: Filters | undefined = undefined;

  constructor(metadata: FictioneerMetadata) {
    this.id = metadata.id;
    this.name = metadata.sourceName;
    this.icon = `multisrc/fictioneer/${metadata.id.toLowerCase()}/icon.png`;
    this.site = metadata.sourceSite;
    const versionIncrements = metadata.options?.versionIncrements || 0;
    this.version = `1.0.${0 + versionIncrements}`;
    this.options = metadata.options;
  }

  async popularNovels(
    pageNo: number,
    {
      showLatestNovels,
      filters,
    }: Plugin.PopularNovelsOptions<typeof this.filters>,
  ): Promise<Plugin.NovelItem[]> {
    const req = await fetchApi(
      this.site +
        '/' +
        this.options.browsePage +
        '/' +
        (pageNo === 1 ? '' : 'page/' + pageNo + '/'),
    );
    const body = await req.text();
    const loadedCheerio = loadCheerio(body);

    return loadedCheerio(
      '#featured-list > li > div > div, #list-of-stories > li > div > div',
    )
      .map((i, el) => {
        const novelName = loadedCheerio(el).find('h3 > a').text();
        const novelCover = loadedCheerio(el)
          .find('a.cell-img:has(img)')
          .attr('href');
        const novelUrl = loadedCheerio(el).find('h3 > a').attr('href');

        return {
          name: novelName,
          cover: novelCover,
          path: novelUrl!.replace(this.site + '/', '').replace(/\/$/, ''),
        };
      })
      .toArray();
  }

  async parseNovel(novelPath: string): Promise<Plugin.SourceNovel> {
    console.log('V2 Parsing novel at path:', novelPath);
    const req = await fetchApi(this.site + '/' + novelPath + '/');
    const body = await req.text();
    const loadedCheerio = loadCheerio(body);

    console.log('Fetched novel page, starting to extract details.');
    const novel: Plugin.SourceNovel = {
      path: novelPath,
      name: loadedCheerio('h1.story__identity-title').text(),
    };
    console.log('Novel name extracted:', novel.name);

    // novel.artist = '';
    novel.author = loadedCheerio('div.story__identity-meta')
      .text()
      .split('|')[0]
      .replace('Author: ', '')
      .replace('by ', '')
      .trim();
    console.log('Novel author extracted:', novel.author);
    novel.cover = loadedCheerio('figure.story__thumbnail > a').attr('href');
    console.log('Novel cover URL extracted:', novel.cover);
    novel.genres = loadedCheerio('div.tag-group > a, section.tag-group > a')
      .map((i, el) => loadedCheerio(el).text())
      .toArray()
      .join(',');
    console.log('Novel genres extracted:', novel.genres);
    novel.summary = loadedCheerio('section.story__summary').text();
    console.log('Novel summary extracted.');

    console.log('Starting to parse chapters for novel:', novel.name);
    novel.chapters = loadedCheerio('li.chapter-group__list-item')
      .filter((i, el) => !el.attribs['class'].includes('_password'))
      .filter((i, el) => !el.attribs['class'].includes('_folding-toggle'))
      .map((i, el) => {
        let prefix = '';

        // --- Check for published chapters showing a normal icon (fa-book)
        const hasBook = loadedCheerio(el).find('i.fa-book').length > 0;

        // --- Check for locked chapters (fa-lock)
        const hasLock = loadedCheerio(el).find('i.fa-lock').length > 0;

        // --- Check for premium/future chapters (span.premium-badge)
        const hasPremium =
          loadedCheerio(el).find('span.premium-badge').length > 0;

        // Prefix priority:
        // 1. Future/premium 🔐
        // 2. Locked 🔒
        // 3. Normal published 📘
        if (hasPremium) {
          prefix = '🔐 ';
        } else if (hasLock) {
          prefix = '🔒 ';
        } else if (hasBook) {
          prefix = '📘 ';
        } else {
          prefix = '';
        }
        const chapterName = loadedCheerio(el).find('a').text().trim();
        console.log('Chapter name:', prefix + chapterName);
        const chapterUrl = loadedCheerio(el)
          .find('a')
          .attr('href')
          ?.replace(this.site + '/', '')
          .replace(/\/$/, '');
        console.log('Chapter URL:', chapterUrl);

        return {
          name: prefix + chapterName,
          path: chapterUrl!,
        };
      })
      .toArray();

    const status = loadedCheerio('span.story__status').text().trim();
    if (status === 'Ongoing') novel.status = NovelStatus.Ongoing;
    if (status === 'Completed') novel.status = NovelStatus.Completed;
    if (status === 'Cancelled') novel.status = NovelStatus.Cancelled;
    if (status === 'Hiatus') novel.status = NovelStatus.OnHiatus;
    console.log('Novel status extracted:', novel.status);

    return novel;
  }

  async parseChapter(chapterPath: string): Promise<string> {
    const req = await fetchApi(this.site + '/' + chapterPath + '/');
    const body = await req.text();

    const loadedCheerio = loadCheerio(body);
    return loadedCheerio('section#chapter-content > div').html() || '';
  }

  async searchNovels(
    searchTerm: string,
    pageNo: number,
  ): Promise<Plugin.NovelItem[]> {
    const req = await fetchApi(
      this.site +
        `/${pageNo === 1 ? '' : 'page/' + pageNo + '/'}?s=${encodeURIComponent(searchTerm)}&post_type=fcn_story`,
    );
    const body = await req.text();
    const loadedCheerio = loadCheerio(body);

    return loadedCheerio('#search-result-list > li > div > div')
      .map((i, el) => {
        const novelName = loadedCheerio(el).find('h3 > a').text();
        const novelCover = loadedCheerio(el)
          .find('a.cell-img:has(img)')
          .attr('href');
        const novelUrl = loadedCheerio(el).find('h3 > a').attr('href');

        return {
          name: novelName,
          cover: novelCover,
          path: novelUrl!.replace(this.site + '/', '').replace(/\/$/, ''),
        };
      })
      .toArray();
  }

  resolveUrl = (path: string, isNovel?: boolean) =>
    this.site + '/' + path + '/';
}
