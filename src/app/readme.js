// The strips under the board: the README preview, the download and copy
// buttons, the three-step install, and the two brag buttons on the end card.
//
// index.html is this file's contract, but only loosely: a cut-down page (the
// og shot, an embed) can be built without the preview <img>, the yaml listing
// or the install steps, so everything optional is looked up and guarded here
// rather than assumed.

import { lawnToSvg } from '../export/svg.js';
import { svgToPngBlob, download, downloadSvg } from '../export/png.js';
import {
  currentUser, markdownSnippet, workflowYaml, copy, bragText, xUrl,
  newWorkflowUrl, actionsUrl, editReadmeUrl, newRepoUrl, WORKFLOW_PATH,
} from '../share.js';
import { periodLabel } from '../core/lawn.js';

const $ = (id) => document.getElementById(id);

let get = { lawn: () => null, year: () => null, whose: () => 'my' };
let previewUrl = '';

// --- the picture ----------------------------------------------------------

/** The exported picture: this lawn, as a standalone SVG. */
function exportSvg(mowed, opts) {
  return lawnToSvg(get.lawn(), { mowed, user: currentUser(), ...opts });
}

/** Download what you mowed; before you start, the half-mowed still. */
function exportState() { return get.lawn().mowed > 0 ? 'as-is' : 0.5; }

function exportName() {
  const year = get.year();
  return 'lawn-' + (currentUser() || 'demo') + '-' + (year === null ? 'last' : year);
}

/**
 * The README section's <img>. One object URL at a time, never per frame.
 * This runs at boot, before the render loop starts, so a throw here would take
 * the whole page down with it (no loop, no controls). Hence the try: the
 * picture is worth less than the lawn.
 *
 * Animated, because the workflow the button next to it installs carries
 * `animate=1`: the preview has to be the picture that actually lands in a
 * README. It costs a few hundred kB, but this runs once per lawn, not per
 * frame. The download buttons stay still pictures of the board as you mowed it.
 */
export function refreshPreview() {
  const img = $('preview');
  if (!img) return;
  let svg;
  try {
    svg = exportSvg(0.5, { animate: true });
  } catch (err) {
    console.error('could not draw the readme preview', err);
    img.removeAttribute('src');
    return;
  }
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  img.src = previewUrl;
}

/**
 * Rasterising takes a moment, so the button says so while it happens. It is
 * disabled meanwhile: a second click would read "rendering..." as the label to
 * put back and the button would keep saying that forever.
 */
async function renderPng(btn, mowed) {
  if (btn.disabled) return;
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'rendering...';
  try {
    download(await svgToPngBlob(exportSvg(mowed), 2), exportName() + '.png');
  } catch (err) {
    console.error(err);
    window.alert('could not make a png here. the svg download works everywhere.');
  }
  btn.textContent = was;
  btn.disabled = false;
}

// --- the three-step install -----------------------------------------------

/**
 * Whose repo the buttons point at, or '' while the demo lawn is up. The loader
 * owns body[data-source] and keeps it honest: a ?user= that failed to load
 * still leaves the demo on screen, so a failed load must not arm the buttons.
 */
function installUser() {
  return document.body.dataset.source === 'user' ? currentUser() : '';
}

/** Send them to the box that has to be filled in before any of this works. */
function nudge() {
  const box = $('user');
  if (!box) return;
  box.focus();
  box.scrollIntoView({ block: 'center', behavior: 'smooth' });
  const note = $('installnote');
  if (!note) return;
  note.classList.remove('flash');
  void note.offsetWidth;
  note.classList.add('flash');
}

/**
 * Point one step's button at a URL, or disarm it. A disarmed button is still
 * clickable on purpose: clicking it is how a visitor finds out what is missing.
 */
function arm(btn, url) {
  if (!btn) return;
  if (url) {
    btn.dataset.url = url;
    btn.title = url;
    btn.removeAttribute('aria-disabled');
  } else {
    delete btn.dataset.url;
    btn.removeAttribute('title');
    btn.setAttribute('aria-disabled', 'true');
  }
}

function say(el, text) {
  if (!el) return;
  el.hidden = !text;
  if (text) el.textContent = text;
}

/**
 * Repaint the three steps for whoever is loaded. Called on every lawn swap,
 * which covers loading an account, going back to the demo and changing year.
 */
export function updateInstall() {
  const u = installUser();
  const repo = u ? `${u}/${u}` : 'you/you';
  document.body.dataset.install = u ? 'on' : 'off';

  arm($('install'), newWorkflowUrl(u));
  arm($('runit'), actionsUrl(u));
  arm($('openreadme'), editReadmeUrl(u));

  say($('installnote'), u
    ? `commits ${WORKFLOW_PATH} to ${repo} - GitHub asks before anything is saved`
    : 'type your username first');
  say($('runnote'), u ? `the "mow the lawn" workflow in ${repo} - press "Run workflow"` : '');
  say($('mdnote'), u ? `paste it at the top of ${repo}/README.md` : '');

  const name = $('reponame');
  if (name) name.textContent = repo;
  const create = $('newrepo');
  if (create) create.href = newRepoUrl(u) || 'https://github.com/new';
}

/** One tab per click, and never one that can reach back into this page. */
function openTab(btn) {
  const url = btn.dataset.url;
  if (!url) { nudge(); return; }
  window.open(url, '_blank', 'noopener');
}

// --- wiring ---------------------------------------------------------------

export function initReadme(getters) {
  get = { ...get, ...getters };

  $('dlsvg').addEventListener('click', () => {
    downloadSvg(exportSvg(exportState()), exportName() + '.svg');
  });
  $('dlpng').addEventListener('click', (e) => renderPng(e.currentTarget, exportState()));
  $('cpmd').addEventListener('click', (e) => copy(markdownSnippet(currentUser()), e.currentTarget));
  $('dlcard').addEventListener('click', (e) => renderPng(e.currentTarget, 'as-is'));

  const brag = () => bragText(get.lawn(), currentUser(), periodLabel(get.lawn()), get.whose());
  $('brag').addEventListener('click', (e) => copy(brag(), e.currentTarget));

  const shareBtn = $('sharex');
  shareBtn.addEventListener('click', () => {
    const text = brag();
    if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
    window.open(xUrl(text), '_blank', 'noopener');
  });
  if (navigator.share) shareBtn.textContent = 'share';

  for (const id of ['install', 'runit', 'openreadme']) {
    const btn = $(id);
    if (btn) btn.addEventListener('click', (e) => openTab(e.currentTarget));
  }

  // optional: the workflow listing and the button that copies it
  if ($('yaml')) {
    $('yaml').textContent = workflowYaml();
    $('cpyml').addEventListener('click', (e) => copy(workflowYaml(), e.currentTarget));
  }

  // optional: the try strip, which is for the demo lawn and hides itself once
  // body[data-source] says an account is up (see style.css).
  if ($('try')) {
    $('try').hidden = false;
    $('tryme').addEventListener('click', () => {
      if ($('user')) { nudge(); return; }
      // a page built without the loader: ask, and reload on ?user=
      const name = window.prompt('github username');
      if (name && name.trim()) location.search = '?user=' + encodeURIComponent(name.trim());
    });
  }

  updateInstall();
}
