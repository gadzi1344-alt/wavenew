// ---------- Подключение к Supabase ----------
const CFG = window.WAVE_CONFIG || {};
function showFatal(msg) {
  const b = document.createElement('div');
  b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99;background:#2a1212;color:#ffb3b3;padding:14px 16px;border-radius:12px;font:14px system-ui,sans-serif;white-space:pre-wrap;box-shadow:0 12px 30px #000a';
  b.textContent = msg;
  document.body.appendChild(b);
}
window.addEventListener('error', (e) => showFatal('Ошибка скрипта: ' + e.message));
window.addEventListener('unhandledrejection', (e) => showFatal('Ошибка: ' + (e.reason?.message || e.reason)));
const sb = (typeof supabase !== 'undefined' && CFG.supabaseUrl)
  ? supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey)
  : null;
if (!sb) showFatal(typeof supabase === 'undefined'
  ? 'Не загрузилась библиотека Supabase. Проверьте интернет и обновите страницу (Ctrl+F5).'
  : 'Не задан адрес Supabase. Проверьте переменные окружения SUPABASE_URL и SUPABASE_PUBLISHABLE_KEY на Vercel.');

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BADGE = { star: '⭐', fire: '🔥', heart: '💜', cat: '🐱', crown: '👑', flower: '🌸', sparkle: '✨', bunny: '🐰' };
const BADGE_LABEL = { star: 'Звезда', fire: 'Огонь', heart: 'Сердечко', cat: 'Котик', crown: 'Корона', flower: 'Цветочек', sparkle: 'Блёстки', bunny: 'Зайка' };
const HEART = '<svg viewBox="0 0 24 24"><path d="M12 20.5s-7.5-4.6-9.6-9.2C.9 8.2 2.8 4.5 6.6 4.5c2.3 0 3.8 1.3 5.4 3.1 1.6-1.8 3.1-3.1 5.4-3.1 3.8 0 5.7 3.7 4.2 6.8-2.1 4.6-9.6 9.2-9.6 9.2z"/></svg>';
const COMMENT = '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';
const EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
const POST_COLS = 'id,text,image_url,views,created_at,user_id';

let me = null;
let route = { name: 'feed', tab: 'all' };
let feedBefore = null;
let pendingImg = '';
let gateMode = 'reg';
let adminList = [];
let focusComments = false;

// ---------- Вспомогательное ----------
const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 0);
const av = (u, cls = 'av') => u.avatar
  ? `<div class="${cls}" style="background-image:url('${esc(u.avatar)}')"></div>`
  : `<div class="${cls}" style="background:#1f1f1f;box-shadow:inset 0 0 0 1px #2e2e2e">${esc(u.name[0].toUpperCase())}</div>`;
const VERIFIED_SVG = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><polygon points="12.00,1.60 14.30,3.40 17.20,2.99 18.29,5.71 21.01,6.80 20.60,9.70 22.40,12.00 20.60,14.30 21.01,17.20 18.29,18.29 17.20,21.01 14.30,20.60 12.00,22.40 9.70,20.60 6.80,21.01 5.71,18.29 2.99,17.20 3.40,14.30 1.60,12.00 3.40,9.70 2.99,6.80 5.71,5.71 6.80,2.99 9.70,3.40" fill="#ffffff" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/><path d="M7.9 12.4l2.7 2.7 5.5-5.6" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const verify = (u) => u.verified ? `<span class="vf" title="Подтверждённый аккаунт">${VERIFIED_SVG}</span>` : '';
const badges = (u) => (u.badges || []).map((b) => `<span class="bd" title="${esc(BADGE_LABEL[b] || '')}">${BADGE[b] || ''}</span>`).join('');
const ago = (ts) => {
  const d = Math.max(0, Date.now() / 1000 - ts);
  if (d < 60) return 'только что';
  if (d < 3600) return Math.floor(d / 60) + ' мин назад';
  if (d < 86400) return Math.floor(d / 3600) + ' ч назад';
  return new Date(ts * 1000).toLocaleDateString('ru-RU');
};
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.style.display = 'block';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => (t.style.display = 'none'), 3200);
}
const mapUser = (p) => p ? { id: p.id, name: p.name, bio: p.bio || '', verified: !!p.verified, badges: p.badges || [], avatar: p.avatar_url || '' } : { name: '?', verified: false, badges: [], avatar: '' };
const mapPost = (r, x) => ({
  id: r.id, text: r.text || '', image: r.image_url || '', views: r.views || 0,
  created: new Date(r.created_at).getTime() / 1000,
  likes: x.likes, comments: x.comments, liked: x.liked.has(r.id),
  can: !!me && (me.admin || r.user_id === me.id),
  author: mapUser(x.profile),
});

// Загружает посты с авторами, счётчиками и отметкой «мой лайк»
async function profilesById(ids) {
  const m = new Map();
  if (!ids.length) return m;
  const { data } = await sb.from('profiles').select('id,name,verified,badges,avatar_url').in('id', ids);
  (data || []).forEach((p) => m.set(p.id, p));
  return m;
}
function countBy(rows) {
  const m = new Map();
  (rows || []).forEach((r) => m.set(r.post_id, (m.get(r.post_id) || 0) + 1));
  return m;
}
async function postsWith(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  if (!data.length) return [];
  const ids = data.map((p) => p.id);
  const [pm, lk, cm, my] = await Promise.all([
    profilesById([...new Set(data.map((p) => p.user_id))]),
    sb.from('likes').select('post_id').in('post_id', ids),
    sb.from('comments').select('post_id').in('post_id', ids),
    me ? sb.from('likes').select('post_id').eq('user_id', me.id).in('post_id', ids) : Promise.resolve({ data: [] }),
  ]);
  const likeCount = countBy(lk.data);
  const commentCount = countBy(cm.data);
  const liked = new Set((my.data || []).map((l) => l.post_id));
  return data.map((r) => mapPost(r, {
    profile: pm.get(r.user_id),
    likes: likeCount.get(r.id) || 0,
    comments: commentCount.get(r.id) || 0,
    liked,
  }));
}

let needName = false;
async function loadMe() {
  const { data } = await sb.auth.getSession();
  if (!data.session) { me = null; needName = false; return; }
  const { data: p } = await sb.from('profiles').select('*').eq('id', data.session.user.id).single();
  me = p ? { ...mapUser(p), admin: p.name === 'bibnaq' } : null;
  needName = !p;
}

// ---------- Маршруты ----------
function go(r) {
  route = r;
  // перезапускаем плавное появление страницы при каждом переходе
  const m = $('#main');
  if (m) { m.style.animation = 'none'; void m.offsetWidth; m.style.animation = ''; }
  render();
}
function setActive() {
  const key = route.name === 'profile' || route.name === 'admin' ? 'profile' : route.name === 'post' ? 'feed' : route.name;
  $$('#nav button, #tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.go === key));
}
async function render() {
  document.body.classList.toggle('gate', !me);
  if (!me) return needName ? renderNameChoice() : renderGate();
  setActive();
  try {
    if (route.name === 'feed') await renderFeed();
    else if (route.name === 'post') await renderPost(route.id);
    else if (route.name === 'profile') await renderProfile(route.user);
    else if (route.name === 'search') renderSearch();
    else if (route.name === 'admin') await renderAdmin();
  } catch (e) {
    $('#main').innerHTML = `<div class="col"><p class="sub center">Ошибка: ${esc(e.message)}</p></div>`;
  }
  watchViews($('#main'));
}

// ---------- Вход и регистрация ----------
function renderGate() {
  document.body.classList.add('gate');
  $('#main').innerHTML = `<div class="gate-wrap"><div class="card gate-card">
    <div class="gate-logo">W</div>
    <h2>Добро пожаловать</h2>
    <p class="sub">Войдите, чтобы смотреть ленту и писать посты</p>
    <button class="pill on" data-oauth="google">Войти через Google</button>
    <button class="pill" data-oauth="github">Войти через GitHub</button>
    <div class="sub" id="gateErr" style="color:#d97070;min-height:16px"></div>
  </div></div>`;
}
function renderNameChoice() {
  document.body.classList.add('gate');
  $('#main').innerHTML = `<div class="gate-wrap"><div class="card gate-card">
    <div class="gate-logo">W</div>
    <h2>Выберите логин</h2>
    <p class="sub">Так вас будут видеть в ленте. Латиница, цифры, _ . - (3–20 символов). Ник можно поменять в профиле.</p>
    <input class="field" id="aname" placeholder="Логин" autocomplete="off">
    <input class="field" id="acode" placeholder="Код администратора (только для админа)" autocomplete="off">
    <div class="sub" id="gateErr" style="color:#d97070;min-height:16px"></div>
    <button class="pill on" id="nameGo">Сохранить</button>
    <button class="pill" data-logout="1">Выйти</button>
  </div></div>`;
}
async function oauthLogin(provider) {
  const { error } = await sb.auth.signInWithOAuth({ provider, options: { redirectTo: location.origin + location.pathname } });
  if (error) throw new Error(error.message);
}
async function saveName() {
  const name = $('#aname').value.trim().toLowerCase();
  if (!/^[a-z0-9_.\-]{3,20}$/.test(name)) throw new Error('Логин: 3–20 символов, латиница, цифры, _ . -');
  const { error } = await sb.rpc('ensure_profile', { uname: name, code: $('#acode').value });
  if (error) throw new Error(/duplicate/i.test(error.message) ? 'Такой логин уже занят' : error.message);
  await loadMe();
  if (!me) throw new Error('Не удалось создать профиль. Обновите страницу.');
  toast('Добро пожаловать, ' + me.name);
  go({ name: 'feed', tab: 'all' });
}

// ---------- Композер и лента ----------
function composer() {
  return `<div class="card comp" id="comp">
    <textarea id="ptext" maxlength="1000" placeholder="Что нового?"></textarea>
    <div id="pthumb"></div>
    <div class="comp-row">
      <label class="attach">📷 Фото<input type="file" id="pfile" accept="image/*"></label>
      <span class="grow"></span>
      <button class="pill on" id="publish">Опубликовать</button>
    </div>
    <div class="sub" id="pstatus" style="margin-top:8px;color:#d97070;min-height:16px"></div>
  </div>`;
}
function postCard(p, i = 0) {
  return `<article class="card" data-open="${p.id}" style="--i:${i}">
    <div class="ph-head">
      ${av(p.author, 'av sm')}
      <div class="who"><span class="nm" data-user="${esc(p.author.name)}">${esc(p.author.name)}${verify(p.author)}${badges(p.author)}</span><span class="tm">${ago(p.created)}</span></div>
      ${p.can ? `<button class="x" data-del="${p.id}" title="Удалить">×</button>` : ''}
    </div>
    ${p.text ? `<p class="txt">${esc(p.text)}</p>` : ''}
    ${p.image ? `<img class="pimg" src="${esc(p.image)}" loading="lazy" alt="">` : ''}
    <div class="acts2">
      <button data-like="${p.id}" class="${p.liked ? 'on' : ''}">${HEART}<b>${p.likes}</b></button>
      <button data-cmt="${p.id}" title="Комментарии">${COMMENT}<b>${p.comments}</b></button>
      <span>${EYE}${p.views}</span>
    </div>
  </article>`;
}

const mapFeedRow = (r) => ({
  id: r.id, text: r.text || '', image: r.image || '', views: r.views || 0,
  created: new Date(r.created).getTime() / 1000,
  likes: Number(r.likes), comments: Number(r.comments), liked: !!r.liked,
  can: !!me && (me.admin || r.user_id === me.id),
  author: { name: r.author_name, verified: !!r.author_verified, badges: r.author_badges || [], avatar: r.author_avatar || '' },
});
const mapCommentRow = (c) => ({
  id: c.id, text: c.text, created: new Date(c.created).getTime() / 1000,
  author: { name: c.author_name, verified: !!c.author_verified, badges: c.author_badges || [], avatar: c.author_avatar || '' },
});
const FEED_LIMIT = 20;
async function renderFeed() {
  const tab = route.tab || 'all';
  $('#main').innerHTML = `<div class="col">
    <h2>Лента</h2>
    <div class="pills" style="margin-top:14px"><button data-tab="all" class="${tab === 'all' ? 'on' : ''}">Для вас</button><button data-tab="follow" class="${tab === 'follow' ? 'on' : ''}">Подписки</button></div>
    ${tab === 'all' ? composer() : ''}
    <div id="feed"></div>
    <div class="more" id="moreBox"></div>
  </div>`;
  $('#publish').onclick = publishPost;
  $('#pfile').onchange = onPostFile;
  feedBefore = null;
  await loadFeed();
}
async function loadFeed() {
  const first = !feedBefore;
  const show = (html) => { const el = $('#feed'); if (el) el.innerHTML = html; };
  try {
    if (route.tab === 'follow' && !me) throw new Error('Войдите, чтобы видеть подписки');
    // Один запрос к базе: посты, авторы, лайки, комментарии и мои лайки
    const { data, error } = await sb.rpc('get_feed', {
      p_before: feedBefore,
      p_user: me ? me.id : null,
      p_only_follow: route.tab === 'follow',
    });
    if (error) throw new Error(error.message);
    const posts = (data || []).map((r) => ({
      id: r.id, text: r.text || '', image: r.image || '', views: r.views || 0,
      created: new Date(r.created).getTime() / 1000,
      likes: Number(r.likes), comments: Number(r.comments), liked: !!r.liked,
      can: !!me && (me.admin || r.user_id === me.id),
      author: { name: r.author_name, verified: !!r.author_verified, badges: r.author_badges || [], avatar: r.author_avatar || '' },
    }));
    const feedEl = $('#feed');
    if (!feedEl) return;
    const offset = first ? 0 : feedEl.querySelectorAll(':scope > .card').length;
    if (first) feedEl.innerHTML = '';
    if (first && !posts.length) {
      feedEl.innerHTML = `<p class="sub center">${route.tab === 'follow' ? 'Подпишитесь на людей, чтобы видеть их посты' : 'Пока пусто. Напишите первый пост!'}</p>`;
    } else {
      feedEl.insertAdjacentHTML('beforeend', posts.map((p, i) => postCard(p, offset + i)).join(''));
      watchViews(feedEl);
    }
    feedBefore = posts.length ? posts[posts.length - 1].id : feedBefore;
    const more = $('#moreBox');
    if (more) more.innerHTML = posts.length >= FEED_LIMIT ? '<button class="pill" data-more>Показать ещё</button>' : '';
  } catch (e) {
    show(`<p class="sub center">Ошибка ленты: ${esc(e.message)}</p>`);
  }
}

async function publishPost() {
  const btn = $('#publish');
  const status = $('#pstatus');
  const text = ($('#ptext')?.value || '').trim();
  status.textContent = '';
  if (!text && !pendingImg) { status.textContent = 'Напишите текст или добавьте фото'; return; }
  btn.disabled = true;
  try {
    const { data, error } = await sb.from('posts').insert({ user_id: me.id, text, image_url: pendingImg }).select(POST_COLS).single();
    if (error) throw new Error(error.message);
    const post = mapPost(data, {
      profile: { id: me.id, name: me.name, verified: me.verified, badges: me.badges, avatar_url: me.avatar },
      likes: 0, comments: 0, liked: new Set(),
    });
    const feedEl = $('#feed');
    if (feedEl) {
      feedEl.querySelectorAll(':scope > .sub').forEach((el) => el.remove());
      feedEl.insertAdjacentHTML('afterbegin', postCard(post));
      watchViews(feedEl);
    }
    $('#ptext').value = '';
    pendingImg = '';
    $('#pthumb').innerHTML = '';
    toast('Пост опубликован');
  } catch (e) {
    status.textContent = 'Не опубликовалось: ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

// ---------- Фото ----------
async function uploadImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Можно загружать только картинки');
  if (file.size > 8 * 1024 * 1024) throw new Error('Файл больше 8 МБ');
  const ext = ((file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')) || 'jpg';
  const path = `${me.id}/${crypto.randomUUID()}.${ext}`;
  const { error } = await sb.storage.from('media').upload(path, file, { contentType: file.type });
  if (error) throw new Error(error.message);
  return sb.storage.from('media').getPublicUrl(path).data.publicUrl;
}
async function onPostFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  try {
    pendingImg = await uploadImage(f);
    $('#pthumb').innerHTML = `<div class="thumb"><img src="${esc(pendingImg)}" alt=""><button data-rmimg>×</button></div>`;
  } catch (err) { toast(err.message); }
}

// ---------- Просмотры: засчитываются, когда пост появился на экране ----------
const seenIds = new Set();
let viewQueue = [];
let viewTimer = null;
function flushViews() {
  if (!viewQueue.length || !me) return;
  const ids = viewQueue;
  viewQueue = [];
  sb.rpc('mark_views', { ids }).then(() => {}, () => {});
}
const io = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const id = Number(en.target.dataset.open);
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    viewQueue.push(id);
    io.unobserve(en.target);
  }
  clearTimeout(viewTimer);
  viewTimer = setTimeout(flushViews, 1500);
}, { threshold: 0.6 }) : null;
function watchViews(root) {
  if (!io || !root) return;
  root.querySelectorAll('[data-open]').forEach((el) => io.observe(el));
}

// ---------- Пост с комментариями ----------
async function renderPost(id) {
  const { data, error } = await sb.rpc('get_post_page', { p_id: id, p_user: me ? me.id : null });
  if (error) throw new Error(error.message);
  if (!data || !data.post) throw new Error('Пост не найден');
  const post = mapFeedRow(data.post);
  const comments = (data.comments || []).map(mapCommentRow);
  $('#main').innerHTML = `<div class="col">
    <button class="pill" data-go="feed" style="margin-bottom:14px">← Назад</button>
    ${postCard(post).replace(`data-open="${post.id}"`, '')}
    <h2 class="section">Комментарии · ${comments.length}</h2>
    ${comments.map((c) => `<div class="card" style="padding:12px 14px">
      <div class="ph-head">${av(c.author, 'av sm')}<div class="who"><span class="nm" data-user="${esc(c.author.name)}">${esc(c.author.name)}${verify(c.author)}${badges(c.author)}</span><span class="tm">${ago(c.created)}</span></div></div>
      <p class="txt" style="margin:8px 0 0">${esc(c.text)}</p></div>`).join('') || '<p class="sub">Комментариев пока нет</p>'}
    <div class="card comp post-comp">
      <textarea id="ctext" maxlength="500" placeholder="Ваш комментарий"></textarea>
      <div class="comp-row"><span class="grow"></span><button class="pill on" data-comment="${post.id}">Отправить</button></div>
    </div>
  </div>`;
  if (focusComments) {
    focusComments = false;
    const ta = $('#ctext');
    if (ta) setTimeout(() => { ta.scrollIntoView({ block: 'end', behavior: 'smooth' }); ta.focus({ preventScroll: true }); }, 60);
  }
}

// ---------- Профиль ----------
function paintProfile(u, data, isMe) {
  const n = (k) => (data ? data[k] : '…');
  const posts = data ? (data.posts || []).map(mapFeedRow) : [];
  const canAdmin = isMe && me.admin;
  const isFollowing = !!(data && data.is_following);
  $('#main').innerHTML = `<div class="col">
    <div class="card" style="padding:22px">
      <div class="prof">
        ${isMe ? `<label class="avatar-pick" title="Сменить фото">${av(u, 'av xl')}<input type="file" id="afile" accept="image/*"></label>` : av(u, 'av xl')}
        <div class="ti">
          <h2>${esc(u.name)}${verify(u)} ${badges(u)}</h2>
          <div class="stats"><span><b>${n('posts_count')}</b>постов</span><span><b>${n('followers')}</b>подписчиков</span><span><b>${n('following')}</b>подписок</span></div>
          <p class="bio">${esc(u.bio) || (isMe ? '<span class="sub">Расскажите о себе</span>' : '')}</p>
          <div class="acts">
            ${isMe ? `<button class="pill" id="editProf">Редактировать профиль</button>
              <button class="pill" id="logout">Выйти</button>
              ${canAdmin ? '<button class="pill on" data-go="admin">Админ-панель</button>' : ''}`
              : me ? `<button class="pill ${isFollowing ? '' : 'on'}" data-follow="${esc(u.name)}">${isFollowing ? 'Отписаться' : 'Подписаться'}</button>` : ''}
          </div>
        </div>
      </div>
    </div>
    <div id="feed">${data ? (posts.map(postCard).join('') || '<p class="sub center">Постов пока нет</p>') : ''}</div>
  </div>`;
  if (isMe) $('#afile').onchange = onAvatarFile;
  watchViews($('#feed'));
}

async function renderProfile(name) {
  const own = !name || (me && name.toLowerCase() === me.name.toLowerCase());
  // Свой профиль показываем сразу из уже загруженных данных
  if (own && me) {
    paintProfile({ id: me.id, name: me.name, bio: me.bio, verified: me.verified, badges: me.badges, avatar_url: me.avatar }, null, true);
  }
  const target = (name || me.name).toLowerCase();
  const { data, error } = await sb.rpc('get_profile_page', { p_name: target, p_user: me ? me.id : null, p_before: null });
  if (route.name !== 'profile') return; // пользователь уже ушёл на другой экран
  if (error) throw new Error(error.message);
  if (!data || !data.user) throw new Error('Пользователь не найден');
  const u = mapUser(data.user);
  paintProfile(u, data, !!me && me.id === u.id);
}
async function onAvatarFile(e) {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const url = await uploadImage(f);
    const { error } = await sb.from('profiles').update({ avatar_url: url }).eq('id', me.id);
    if (error) throw new Error(error.message);
    toast('Аватарка обновлена');
    renderProfile();
  } catch (err) { toast(err.message); }
}
async function toggleFollow(name) {
  if (!me) return toast('Войдите, чтобы подписываться');
  const { data: t, error: terr } = await sb.from('profiles').select('id').eq('name', name.toLowerCase()).maybeSingle();
  if (terr || !t) throw new Error('Пользователь не найден');
  if (t.id === me.id) return;
  const { data: ex } = await sb.from('follows').select('follower_id').eq('follower_id', me.id).eq('followee_id', t.id);
  if (ex && ex.length) await sb.from('follows').delete().eq('follower_id', me.id).eq('followee_id', t.id);
  else await sb.from('follows').insert({ follower_id: me.id, followee_id: t.id });
  renderProfile(name);
}

// ---------- Редактирование профиля: ник, описание, аватар ----------
function openEditor() {
  if (!me || document.querySelector('.modal')) return;
  let pickedFile = null;
  let previewUrl = '';
  const ov = document.createElement('div');
  ov.className = 'modal';
  ov.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="Редактировать профиль">
    <div class="sheet-head">
      <button class="x" data-close title="Закрыть">×</button>
      <b>Профиль</b>
      <button class="pill on" data-save>Сохранить</button>
    </div>
    <label class="ed-av" title="Сменить фото">
      <span id="edPrev">${av(me, 'av xl')}</span>
      <span class="sub">Нажмите, чтобы сменить фото</span>
      <input type="file" id="edFile" accept="image/*" hidden>
    </label>
    <label class="lbl">Ник
      <input class="field" id="edName" maxlength="20" value="${esc(me.name)}" autocomplete="off" ${me.admin ? 'disabled' : ''}>
    </label>
    <div class="sub">Латиница, цифры, _ . - (3–20 символов).${me.admin ? ' Ник администратора менять нельзя.' : ''}</div>
    <label class="lbl">Описание
      <textarea class="field" id="edBio" maxlength="200" rows="4">${esc(me.bio)}</textarea>
    </label>
    <div class="sub" id="edCount" style="text-align:right">${esc(me.bio).length}/200</div>
    <div class="sub" id="edErr" style="color:#e07070;min-height:16px"></div>
  </div>`;
  document.body.appendChild(ov);

  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const close = () => {
    document.removeEventListener('keydown', onKey);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    ov.classList.add('out');
    setTimeout(() => ov.remove(), 220);
  };
  document.addEventListener('keydown', onKey);
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('[data-close]')) close();
  });
  ov.querySelector('#edBio').addEventListener('input', (e) => {
    ov.querySelector('#edCount').textContent = e.target.value.length + '/200';
  });
  ov.querySelector('#edFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) return toast('Можно загружать только картинки');
    if (f.size > 8 * 1024 * 1024) return toast('Файл больше 8 МБ');
    pickedFile = f;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = URL.createObjectURL(f);
    ov.querySelector('#edPrev').innerHTML = `<div class="av xl" style="background-image:url('${previewUrl}')"></div>`;
  });
  ov.querySelector('[data-save]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const errEl = ov.querySelector('#edErr');
    const name = ov.querySelector('#edName').value.trim().toLowerCase();
    const bio = ov.querySelector('#edBio').value.slice(0, 200);
    errEl.textContent = '';
    btn.disabled = true;
    try {
      if (name !== me.name) {
        if (me.admin) throw new Error('Ник администратора менять нельзя');
        if (!/^[a-z0-9_.\-]{3,20}$/.test(name)) throw new Error('Ник: 3–20 символов, латиница, цифры, _ . -');
        const { error } = await sb.rpc('change_username', { new_name: name });
        if (error) throw new Error(/duplicate/i.test(error.message) ? 'Такой ник уже занят' : error.message);
      }
      const patch = { bio };
      if (pickedFile) patch.avatar_url = await uploadImage(pickedFile);
      const { error: upErr } = await sb.from('profiles').update(patch).eq('id', me.id);
      if (upErr) throw new Error(upErr.message);
      await loadMe();
      close();
      toast('Профиль сохранён');
      go({ name: 'profile', user: null });
    } catch (err) {
      errEl.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------- Поиск ----------
function renderSearch() {
  $('#main').innerHTML = `<div class="col">
    <h2>Поиск</h2>
    <input class="field" id="sq" placeholder="Люди и посты" style="margin:14px 0 18px" autocomplete="off">
    <div id="sres"></div>
  </div>`;
  runSearch('');
}
let searchTimer;
async function runSearch(q) {
  if (!$('#sres')) return;
  const pat = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
  try {
    const { data: us } = q
      ? await sb.from('profiles').select('*').ilike('name', pat).limit(12)
      : await sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(12);
    const users = (us || []).map(mapUser);
    const posts = q ? await postsWith(sb.from('posts').select(POST_COLS).ilike('text', pat).order('id', { ascending: false }).limit(12)) : [];
    const el = $('#sres');
    if (!el) return;
    el.innerHTML = `
      ${users.length ? `<h2 class="section">Люди</h2>${users.map((u) => `
        <div class="urow"><div class="ph-head" style="flex:1;min-width:0">${av(u, 'av sm')}<div class="who"><span class="nm" data-user="${esc(u.name)}">${esc(u.name)}${verify(u)}${badges(u)}</span><span class="tm">${esc(u.bio)}</span></div></div></div>`).join('')}` : ''}
      ${posts.length ? `<h2 class="section">Посты</h2>${posts.map(postCard).join('')}` : ''}
      ${!users.length && !posts.length && q ? '<p class="sub center">Ничего не найдено</p>' : ''}`;
    watchViews(el);
  } catch (e) {
    const el = $('#sres');
    if (el) el.innerHTML = `<p class="sub">${esc(e.message)}</p>`;
  }
}

// ---------- Админ-панель: галочка и значки ----------
async function renderAdmin() {
  if (!me || !me.admin) return go({ name: 'profile' });
  const { data } = await sb.from('profiles').select('id,name,bio,verified,badges,avatar_url').order('created_at', { ascending: false }).limit(100);
  adminList = (data || []).map(mapUser);
  $('#main').innerHTML = `<div class="col">
    <button class="pill" data-go="profile" style="margin-bottom:14px">← В профиль</button>
    <h2>Админ-панель</h2>
    <p class="sub" style="margin:6px 0 16px">Выдавайте галочку и значки. Изменения сохраняются сразу.</p>
    <div id="alist">${adminList.map(adminRow).join('')}</div>
  </div>`;
}
function adminRow(u) {
  return `<div class="urow" data-admin="${esc(u.name)}">
    <div class="ph-head" style="min-width:140px">${av(u, 'av sm')}<div class="who"><span class="nm">${esc(u.name)}${verify(u)}</span></div></div>
    <button class="switch ${u.verified ? 'on' : ''}" data-verify="${esc(u.name)}">${u.verified ? 'Галочка: да' : 'Галочка: нет'}</button>
    <div class="chips">${Object.keys(BADGE).map((k) => `<button class="chip ${u.badges.includes(k) ? 'on' : ''}" data-badge="${k}" data-for="${esc(u.name)}" title="${BADGE_LABEL[k]}">${BADGE[k]}</button>`).join('')}</div>
  </div>`;
}
async function saveAdmin(name) {
  const u = adminList.find((x) => x.name === name);
  const { error } = await sb.rpc('admin_set_profile', { target: name, is_verified: u.verified, new_badges: u.badges });
  if (error) { await renderAdmin(); throw new Error(error.message); }
  const row = $(`[data-admin="${CSS.escape(name)}"]`);
  if (row) row.outerHTML = adminRow(u);
}

// ---------- Действия ----------
document.addEventListener('click', async (e) => {
  const t = (sel) => e.target.closest(sel);
  try {
    if (t('[data-oauth]')) {
      const el = $('#gateErr');
      try { await oauthLogin(t('[data-oauth]').dataset.oauth); } catch (er) { if (el) el.textContent = er.message; }
      return;
    }
    if (t('#nameGo')) {
      const el = $('#gateErr');
      try { await saveName(); } catch (er) { if (el) el.textContent = er.message; toast(er.message); }
      return;
    }
    if (t('[data-logout]')) {
      await sb.auth.signOut();
      me = null;
      needName = false;
      return render();
    }
    if (t('[data-go]')) return go({ name: t('[data-go]').dataset.go, tab: 'all', user: null });
    if (t('#newBtn') || t('#tabNew')) { go({ name: 'feed', tab: 'all' }); setTimeout(() => $('#ptext')?.focus(), 200); return; }
    if (t('[data-tab]')) { route.tab = t('[data-tab]').dataset.tab; return renderFeed(); }
    if (t('[data-more]')) return loadFeed();
    if (t('[data-rmimg]')) { pendingImg = ''; $('#pthumb').innerHTML = ''; return; }
    if (t('[data-del]')) {
      e.stopPropagation();
      if (!confirm('Удалить пост?')) return;
      const { error } = await sb.from('posts').delete().eq('id', Number(t('[data-del]').dataset.del));
      if (error) throw new Error(error.message);
      if (route.name === 'post') return go({ name: 'feed', tab: 'all' });
      return render();
    }
    if (t('[data-like]')) {
      e.stopPropagation();
      if (!me) return toast('Войдите, чтобы ставить лайки');
      const btn = t('[data-like]');
      const id = Number(btn.dataset.like);
      const counter = btn.querySelector('b');
      const was = btn.classList.contains('on');
      const before = Number(counter.textContent) || 0;
      btn.classList.toggle('on', !was);
      counter.textContent = was ? before - 1 : before + 1;
      const req = was
        ? sb.from('likes').delete().eq('post_id', id).eq('user_id', me.id)
        : sb.from('likes').insert({ post_id: id, user_id: me.id });
      req.then(({ error }) => {
        if (error) {
          btn.classList.toggle('on', was);
          counter.textContent = before;
          toast(error.message);
        }
      });
      return;
    }
    if (t('[data-comment]')) {
      const text = $('#ctext').value.trim();
      if (!text) return toast('Напишите комментарий');
      const id = Number(t('[data-comment]').dataset.comment);
      const { error } = await sb.from('comments').insert({ post_id: id, user_id: me.id, text });
      if (error) throw new Error(error.message);
      return renderPost(id);
    }
    if (t('[data-user]')) { e.stopPropagation(); return go({ name: 'profile', user: t('[data-user]').dataset.user }); }
    if (t('[data-follow]')) return toggleFollow(t('[data-follow]').dataset.follow);
    if (t('[data-cmt]')) { e.stopPropagation(); focusComments = true; return go({ name: 'post', id: Number(t('[data-cmt]').dataset.cmt) }); }
    if (t('[data-open]')) return go({ name: 'post', id: Number(t('[data-open]').dataset.open) });
    if (t('#editProf')) return openEditor();
    if (t('#logout')) {
      await sb.auth.signOut();
      me = null;
      return go({ name: 'feed', tab: 'all' });
    }
    if (t('[data-verify]')) {
      const u = adminList.find((x) => x.name === t('[data-verify]').dataset.verify);
      u.verified = !u.verified;
      return saveAdmin(u.name);
    }
    if (t('[data-badge]')) {
      const b = t('[data-badge]');
      const u = adminList.find((x) => x.name === b.dataset.for);
      const k = b.dataset.badge;
      u.badges = u.badges.includes(k) ? u.badges.filter((x) => x !== k) : [...u.badges, k].slice(0, 8);
      return saveAdmin(u.name);
    }
  } catch (err) {
    toast(err.message);
  }
});

document.addEventListener('change', (e) => {
  if (e.target.id === 'pfile') onPostFile(e);
});
document.addEventListener('input', (e) => {
  if (e.target.id === 'sq') {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => runSearch(e.target.value.trim()), 250);
  }
});

// ---------- Старт ----------
let booted = false;
if (sb) {
  sb.auth.onAuthStateChange(async (event) => {
    if (!booted) return; // стартовую загрузку делает блок ниже
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') { await loadMe(); render(); }
  });
  (async () => {
    try { await loadMe(); } catch (e) { showFatal('Не удалось проверить вход: ' + e.message); }
    booted = true;
    go({ name: 'feed', tab: 'all' });
  })();
}

// ---------- PWA: сервис-воркер ----------
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
