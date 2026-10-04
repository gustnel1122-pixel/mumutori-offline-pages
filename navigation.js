(() => {
  'use strict';
  const start = () => {
    const sidebar = document.getElementById('project-sidebar');
    const toggle = document.getElementById('menu-toggle');
    const backdrop = document.getElementById('nav-backdrop');
    if (!sidebar || !toggle || !backdrop) return;
    const mobile = window.matchMedia('(max-width: 900px)');
    const links = [...sidebar.querySelectorAll('nav a[href^="#"]')];
    const setOpen = (open, restoreFocus = false) => {
      document.body.classList.toggle('nav-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      backdrop.hidden = !open;
      sidebar.inert = mobile.matches && !open;
      if (open) links[0]?.focus();
      else if (restoreFocus) toggle.focus();
    };
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    backdrop.addEventListener('click', () => setOpen(false, true));
    sidebar.querySelector('[data-close-nav]').addEventListener('click', () => setOpen(false, true));
    [...sidebar.querySelectorAll('a[href^="#"]')].forEach(link => link.addEventListener('click', () => {
      if (mobile.matches) {
        setOpen(false);
        const section = document.querySelector(link.hash);
        if (section) { section.setAttribute('tabindex', '-1'); section.focus({ preventScroll: true }); }
      }
    }));
    sidebar.querySelector('[data-export-records]').addEventListener('click', () => {
      document.getElementById('export-button')?.click();
      if (mobile.matches) setOpen(false, true);
    });
    document.addEventListener('keydown', event => {
      if (!document.body.classList.contains('nav-open')) return;
      if (event.key === 'Escape') { event.preventDefault(); setOpen(false, true); }
      if (event.key === 'Tab') {
        const focusable = [...sidebar.querySelectorAll('a,button')].filter(el => el.getBoundingClientRect().width > 0);
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    });
    const onWidthChange = () => setOpen(false);
    mobile.addEventListener('change', onWidthChange);
    onWidthChange();
    const sections = links.map(link => document.querySelector(link.hash)).filter(Boolean);
    let frame = 0;
    const updateActive = () => {
      frame = 0;
      let current = sections[0];
      const threshold = mobile.matches ? 145 : 110;
      sections.forEach(section => { if (section.getBoundingClientRect().top <= threshold) current = section; });
      links.forEach(link => {
        const active = current && link.hash === '#' + current.id;
        if (active) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    };
    window.addEventListener('scroll', () => { if (!frame) frame = requestAnimationFrame(updateActive); }, { passive: true });
    window.addEventListener('resize', updateActive, { passive: true });
    window.addEventListener('load', updateActive, { once: true });
    if (document.fonts) document.fonts.ready.then(updateActive);
    updateActive();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
