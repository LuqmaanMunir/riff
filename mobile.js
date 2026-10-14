'use strict';

// Keep one player and one navigation state. Mobile controls delegate to the
// existing desktop actions rather than maintaining a second music library.
document.addEventListener('DOMContentLoaded', () => {
  const media = window.matchMedia('(max-width: 768px)');
  const nav = document.getElementById('mobile-nav');
  const menu = document.getElementById('mobile-menu');
  const player = document.getElementById('playbar');
  const expand = document.getElementById('mobile-player-toggle');
  let returnFocus = null;

  function closeMenu() {
    if (menu.open) menu.close();
  }

  function setExpanded(open) {
    player.classList.toggle('mobile-expanded', open && media.matches);
    expand.setAttribute('aria-expanded', String(open && media.matches));
    expand.setAttribute('aria-label', open ? 'Collapse player' : 'Expand player');
    expand.textContent = open ? 'Collapse' : 'Player';
  }

  function syncNavigation() {
    const active = document.querySelector('.content-view.active');
    const view = active ? active.id.replace('view-', '') : 'discover';
    const current = ['discover', 'favorites', 'queue'].includes(view) ? view : 'more';
    nav.querySelectorAll('[data-tab]').forEach(button => {
      if (button.dataset.tab === current) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    document.getElementById('mobile-view-title').textContent = {
      discover: 'Discover', favorites: 'Favorites', local: 'My files',
      history: 'History', queue: 'Queue', settings: 'Settings',
      'playlist-detail': 'Playlist', artist: 'Artist'
    }[view] || 'Discover';
  }

  function runAction(button) {
    const target = document.getElementById(button.dataset.target);
    closeMenu();
    if (target) target.click();
  }

  nav.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.target) runAction(button);
    else if (button.dataset.tab === 'search') {
      document.getElementById('search-input').focus();
    } else if (button.dataset.tab === 'more') {
      returnFocus = button;
      menu.showModal();
    }
  });
  menu.addEventListener('click', event => {
    const button = event.target.closest('[data-target]');
    if (button) {
      // The original click must not reach the desktop outside-click handler
      // after the delegated action has just opened its drawer.
      event.stopPropagation();
      runAction(button);
    }
    // Clicking the backdrop is outside the dialog's rectangle.
    if (event.target === menu) {
      const rect = menu.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right ||
          event.clientY < rect.top || event.clientY > rect.bottom) closeMenu();
    }
  });
  document.getElementById('mobile-menu-close').addEventListener('click', closeMenu);
  menu.addEventListener('close', () => {
    if (returnFocus && media.matches) returnFocus.focus();
  });
  expand.addEventListener('click', () => setExpanded(!player.classList.contains('mobile-expanded')));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && player.classList.contains('mobile-expanded')) {
      setExpanded(false);
      expand.focus();
    }
  });
  new MutationObserver(syncNavigation).observe(document.getElementById('main-content'), {
    subtree: true, attributes: true, attributeFilter: ['class']
  });
  function updateViewport() {
    closeMenu();
    setExpanded(false);
    // The desktop panel starts open; on phones it is an explicitly opened sheet.
    if (media.matches) document.getElementById('btn-close-right-panel').click();
  }
  media.addEventListener('change', updateViewport);
  updateViewport();
  syncNavigation();
});
