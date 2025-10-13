import fs from 'fs';
import path from 'path';

const PLUGIN_DIR = path.join('./src/plugins/chinese'); // китайские плагины
const TRANSLATE_FILE = path.join('./src/libs/googleTranslate.ts');
const MAKE_ABSOLUTE_FILE = path.join('./src/libs/makeAbsolute.ts');

// Читаем код translate
if (!fs.existsSync(TRANSLATE_FILE)) {
  console.error('Cannot find googleTranslate.ts');
  process.exit(1);
}
const translateCode = fs.readFileSync(TRANSLATE_FILE, 'utf-8');

// Читаем код makeAbsolute
if (!fs.existsSync(MAKE_ABSOLUTE_FILE)) {
  console.error('Cannot find makeAbsolute.ts');
  process.exit(1);
}
const makeAbsoluteCode = fs.readFileSync(MAKE_ABSOLUTE_FILE, 'utf-8');

// Получаем все файлы плагинов
const pluginFiles = fs.readdirSync(PLUGIN_DIR).filter(f => f.endsWith('.ts'));

pluginFiles.forEach(file => {
  const filePath = path.join(PLUGIN_DIR, file);
  let content = fs.readFileSync(filePath, 'utf-8');

  // Удаляем всё после export default new ...Plugin();
  const exportRegex = /export\s+default\s+new\s+\w+Plugin\s*\(\s*\)\s*;/;
  const match = content.match(exportRegex);
  if (match) {
    content = content.slice(0, match.index + match[0].length);
  } else {
    console.warn(
      `Cannot find "export default new ...Plugin();" in ${file}, skipping deletion`,
    );
  }

  // Проверяем, что код makeAbsolute ещё не вставлен
  const hasMakeAbsolute =
    content.includes('function makeAbsolute(') ||
    content.includes('export const makeAbsolute =');
  if (!hasMakeAbsolute) {
    // Вставляем makeAbsolute
    content +=
      '\n\n' +
      `//DON'T CHANGE IT HERE!` +
      '\n\n' +
      '//This is the copy of @libs/isAbsolutUrl/makeAbsolute.' +
      '\n' +
      makeAbsoluteCode +
      '\n';
    console.log(`Inserted makeAbsolute into ${file}`);
  } else {
    console.log(`makeAbsolute already exists in ${file}, skipped`);
  }

  // Проверяем, что код translate ещё не вставлен
  if (
    !content.includes('function translate(') &&
    !content.includes('export async function translate(')
  ) {
    // Вставляем код в конец файла (после export default)
    content +=
      '\n' +
      '//This is the copy of @libs/googleTranslate.ts' +
      '\n' +
      translateCode +
      '\n';
    fs.writeFileSync(filePath, content, 'utf-8');
    console.log(`Inserted translate into ${file}`);
  } else {
    console.log(`translate already exists in ${file}, skipped`);
  }
});

console.log('All done ✅');
