(() => {
  const preview = document.createElement('div');
  preview.className = 'bookmark-preview';
  preview.hidden = true;
  const image = document.createElement('img');
  preview.append(image);
  document.body.append(preview);
  const cache = new Map();
  let activeLink;
  let timer;

  function hide() {
    clearTimeout(timer);
    activeLink = null;
    preview.hidden = true;
  }

  async function show(link, url) {
    activeLink = link;
    try {
      if (!cache.has(url.href)) {
        const api = new URL('/w/api.php', url.origin);
        api.search = new URLSearchParams({
          action: 'query', prop: 'pageimages', piprop: 'thumbnail',
          pithumbsize: '560', titles: decodeURIComponent(url.pathname.slice(6)),
          redirects: '1', format: 'json', formatversion: '2', origin: '*',
        });
        cache.set(url.href, fetch(api).then(response => {
          if (!response.ok) throw new Error('Preview unavailable');
          return response.json();
        }).then(data => data.query?.pages?.[0]?.thumbnail));
      }
      const thumbnail = await cache.get(url.href);
      if (!thumbnail || activeLink !== link) return;
      image.src = thumbnail.source;
      image.alt = `Wikipedia image for ${link.textContent.trim()}`;
      await image.decode();
      if (activeLink !== link) return;
      const rect = link.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) return;
      preview.hidden = false;
      const width = preview.offsetWidth;
      const height = preview.offsetHeight;
      preview.style.left = `${Math.max(12, Math.min(rect.left, innerWidth - width - 12))}px`;
      preview.style.top = `${Math.max(12, rect.bottom + height + 12 <= innerHeight
        ? rect.bottom + 8 : rect.top - height - 8)}px`;
    } catch {
      cache.delete(url.href);
      if (activeLink === link) hide();
    }
  }

  document.querySelectorAll('.content-bookmarks .prose a').forEach(link => {
    const url = new URL(link.href);
    if (url.hostname !== 'en.wikipedia.org' || !url.pathname.startsWith('/wiki/')) return;
    link.addEventListener('pointerenter', event => {
      if (event.pointerType === 'touch') return;
      hide();
      timer = setTimeout(() => show(link, url), 180);
    });
    link.addEventListener('pointerleave', hide);
    link.addEventListener('focus', () => { hide(); show(link, url); });
    link.addEventListener('blur', hide);
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') hide(); });
  window.addEventListener('scroll', () => { if (!preview.hidden) hide(); }, { passive: true });
  window.addEventListener('resize', hide);
})();
