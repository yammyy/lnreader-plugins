export const NovelStatus = {
  Unknown: 'Unknown',
  Ongoing: 'Ongoing',
  Completed: 'Completed',
  Licensed: 'Licensed',
  PublishingFinished: 'Publishing Finished',
  Cancelled: 'Cancelled',
  OnHiatus: 'On Hiatus',
} as const;

export const defaultCover =
  'https://github.com/LNReader/lnreader-plugins/blob/main/icons/src/coverNotAvailable.jpg?raw=true';

export const DefaultNovelParams = {
  defaultTitle: 'Unknown Title',
  defaultPath: '',
};

export const DebugMessages = {
  FetchPopular: 'Fetching popular novels from ',
  FetchHomepage: 'Fetching homepage from ',
  FailedPopular: 'Failed to fetch popular novels with status ',
  FailedHomepage: 'Failed to fetch homepage with status ',
  SuccessPopular: 'Successfully fetched popular novels.',
  SuccessHomepage: 'Successfully fetched homepage.',
  SuccessLoaded: 'Successfully loaded cheerio object.',
  StartParsing: 'Started parsing novels.',
  InProgressParsing: 'Parsing novel: ',
  EndParsing: 'Finished parsing novels.',
  StartNovel: 'Starting novel details fetch for ',
  FailedNovelPage: 'Failed to fetch novel page with status ',
  SuccessNovelPage: 'Successfully fetched novel page.',
  SuccessLoadedNovelPage: 'Successfully loaded cheerio object for novel page.',
  TotalChapters: 'Total chapters found: ',
};
