// Сборка для Vercel: создаёт public/config.js из переменных окружения.
// Переменные задаются в Vercel → Project → Settings → Environment Variables.
const fs = require('fs');
const path = require('path');

const url = process.env.SUPABASE_URL || 'https://ruwgepjzfxkdruqdxvfp.supabase.co';
const key = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_zLy_AdJpkGd_dVC8b64frQ_97DaIYA9';

if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)) {
  console.error('SUPABASE_URL должен выглядеть как https://<project>.supabase.co');
  process.exit(1);
}

const out = `// Сгенерировано scripts/build.js. Не редактируйте вручную.
window.WAVE_CONFIG = ${JSON.stringify({ supabaseUrl: url, supabaseKey: key }, null, 2)};
`;

fs.writeFileSync(path.join(__dirname, '..', 'public', 'config.js'), out, 'utf8');
console.log('config.js создан для ' + url);
