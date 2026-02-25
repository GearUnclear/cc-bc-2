const LICENSES = [
  {
    name: "by-nc-nd",
    url: "http://creativecommons.org/licenses/by-nc-nd/3.0/",
    bc_id: 2,
    count: 16691,
  },
  {
    name: "by-nc-sa",
    url: "http://creativecommons.org/licenses/by-nc-sa/3.0/",
    bc_id: 3,
    count: 15674,
  },
  {
    name: "by-nc",
    url: "http://creativecommons.org/licenses/by-nc/3.0/",
    bc_id: 4,
    count: 5894,
  },
  {
    name: "by-nd",
    url: "http://creativecommons.org/licenses/by-nd/3.0/",
    bc_id: 5,
    count: 1319,
  },
  {
    name: "by-sa",
    url: "http://creativecommons.org/licenses/by-sa/3.0/",
    bc_id: 8,
    count: 4044,
  },
  {
    name: "by",
    url: "http://creativecommons.org/licenses/by/3.0/",
    bc_id: 6,
    count: 10498,
  },
];

const LICENSE_EXPLANATIONS = {
  by: "requires attribution",
  nc: "no commercial use",
  nd: "no derivatives",
  sa: "share-alike",
};

const BRAND = {
  appName: "Free Music Finder",
  byline: "by wagenhoffer.dev",
  subtitle:
    "Find Creative Commons music fast. Filter by tag and license terms, then open albums on Bandcamp.",
  navDiscover: "Discover by Tag",
  navResults: "Results",
  navAdvanced: "Advanced Filters",
};

const LICENSE_TERM_LEGEND = [
  { code: "by", meaning: "attribution required" },
  { code: "nc", meaning: "non-commercial use only" },
  { code: "sa", meaning: "share-alike required" },
  { code: "nd", meaning: "no derivatives" },
];

const LICENSE_BADGE_ORDER = ["nc", "sa", "nd"];
const LICENSE_BADGES = [
  { token: "nc", label: "NC", requirement: "No commercial use." },
  {
    token: "sa",
    label: "SA",
    requirement: "Derivatives must be shared under the same license.",
  },
  { token: "nd", label: "ND", requirement: "No derivative works allowed." },
];
const LICENSE_BADGE_HINT =
  "SA and ND cannot be combined in a standard Creative Commons license.";
const LOCKED_BY_TOOLTIP =
  "Attribution is required for all standard Creative Commons licenses.";
const STANDARD_LICENSE_CODES = new Set(
  LICENSES.map((license) => license.name.toLowerCase())
);

const LOW_COUNT = 200;
const VERY_LOW_COUNT = 10;
const LANDING_COUNT = 10;
const SAMPLE_COUNT = 5;
const URL_CAP = 10;
const ROUTES = new Set(["/", "/list", "/advanced"]);

const licenseById = new Map(LICENSES.map((license) => [license.bc_id, license]));
const licenseByName = new Map(
  LICENSES.map((license) => [license.name.toLowerCase(), license])
);

const appEl = document.getElementById("app");

const baseAdvancedFilters = {
  includeTags: "",
  excludeTags: "",
  includeString: "",
  excludeString: "",
  includeLicense: "",
  capUrlsPerAccount: false,
};

const state = {
  loadingTags: "not-started",
  loadingUrls: "not-started",
  tags: [],
  urls: [],
  tagById: new Map(),
  tagByName: new Map(),
  urlById: new Map(),
  playerData: null,

  route: {
    path: "/",
    query: new URLSearchParams(),
  },

  tagSearch: "",
  debouncedTagSearch: "",
  filterLowCount: "top",
  tagDebounceTimer: null,

  listShowAll: false,
  listCache: {
    key: "",
    shuffled: [],
  },

  advanced: {
    inputs: { ...baseAdvancedFilters },
    filters: { ...baseAdvancedFilters },
    showAll: false,
  },
};

init();

function init() {
  if (!appEl) return;

  appEl.addEventListener("click", handleAppClick);
  appEl.addEventListener("submit", handleAppSubmit);
  appEl.addEventListener("input", handleAppInput);
  window.addEventListener("hashchange", onRouteChange);

  onRouteChange();
  loadTags();
  loadUrls();
}

function onRouteChange() {
  state.route = parseRoute();
  state.listShowAll = false;
  window.scrollTo(0, 0);
  render();
}

function parseRoute() {
  const hash = window.location.hash || "#/";
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathPart, queryPart = ""] = raw.split("?");

  let path = pathPart || "/";
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }

  if (!ROUTES.has(path)) {
    path = "/";
  }

  return {
    path,
    query: new URLSearchParams(queryPart),
  };
}

async function loadTags() {
  if (state.loadingTags !== "not-started") return;

  state.loadingTags = "loading";
  render();

  try {
    const tagData = await fetchDataJson("tags.json");
    state.tags = Array.isArray(tagData)
      ? [...tagData].sort((a, b) => b.count - a.count)
      : [];

    state.tagById.clear();
    state.tagByName.clear();
    for (const tag of state.tags) {
      state.tagById.set(tag.tag_id, tag);
      state.tagByName.set(String(tag.name || "").toLowerCase(), tag);
    }

    state.loadingTags = "loaded";
  } catch (error) {
    console.error("Failed to load tags", error);
    state.loadingTags = "error";
  }

  render();
}

async function loadUrls() {
  if (state.loadingUrls !== "not-started") return;

  state.loadingUrls = "loading";
  render();

  try {
    const urlData = await fetchDataJson("urls.json");
    state.urls = Array.isArray(urlData) ? urlData : [];

    state.urlById.clear();
    for (const listing of state.urls) {
      state.urlById.set(listing.url_id, listing);
    }

    state.loadingUrls = "loaded";
  } catch (error) {
    console.error("Failed to load urls", error);
    state.loadingUrls = "error";
  }

  render();
}

async function fetchDataJson(fileName) {
  const paths = getDataPaths(fileName);

  for (const path of paths) {
    try {
      const response = await fetch(path, { cache: "no-cache" });
      if (!response.ok) continue;
      return await response.json();
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(`Could not load ${fileName}`);
}

function getDataPaths(fileName) {
  const pathname = window.location.pathname || "/";
  const baseDir = pathname.endsWith("/")
    ? pathname
    : pathname.slice(0, pathname.lastIndexOf("/") + 1) || "/";
  const firstSegment = pathname.split("/").filter(Boolean)[0];
  const repoBase = firstSegment ? `/${firstSegment}/` : "/";

  return Array.from(
    new Set([
      `./public/${fileName}`,
      `public/${fileName}`,
      `${baseDir}public/${fileName}`,
      `${repoBase}public/${fileName}`,
      `/public/${fileName}`,
      `./${fileName}`,
      fileName,
    ])
  );
}

function render() {
  if (!appEl) return;

  const queryFilters = getQueryFilters(state.route.query);
  const queryFilteredUrls =
    state.loadingUrls === "loaded"
      ? filterUrlsByQuery(state.urls, queryFilters)
      : [];

  const randomLabel = getRandomButtonLabel(queryFilters, queryFilteredUrls);
  const randomDisabled =
    state.loadingUrls !== "loaded" || collapseUrls(queryFilteredUrls).length === 0;

  const listHref = buildRoute("/list", state.route.query);
  const advancedHref = buildRoute("/advanced", state.route.query);

  appEl.innerHTML = `
    <div class="app-shell">
      <main class="layout">
        <header class="hero animate-enter">
          <a href="#/" class="hero__logo">${BRAND.appName}</a>
          <p class="hero__byline">${BRAND.byline}</p>
          <p class="hero__subtitle">${BRAND.subtitle}</p>
          <p class="hero__meta">
            ${state.loadingUrls === "loaded" ? `${formatCount(state.urls.length)} albums` : "Loading albums"}
            •
            ${state.loadingTags === "loaded" ? `${formatCount(state.tags.length)} tags` : "Loading tags"}
          </p>

          <nav class="hero__nav">
            <a href="#/" class="hero__nav-link ${
              state.route.path === "/" ? "is-active" : ""
            }">${BRAND.navDiscover}</a>
            <a href="${listHref}" class="hero__nav-link ${
              state.route.path === "/list" ? "is-active" : ""
            }">${BRAND.navResults}</a>
            <a href="${advancedHref}" class="hero__nav-link ${
              state.route.path === "/advanced" ? "is-active" : ""
            }">${BRAND.navAdvanced}</a>
          </nav>

          <button
            class="hero__random"
            data-action="random-global"
            ${randomDisabled ? "disabled" : ""}
          >
            ${escapeHtml(randomLabel)}
          </button>
        </header>

        <section class="panel animate-enter animate-enter--delay">
          ${renderRouteContent(queryFilters, queryFilteredUrls)}
        </section>

        ${renderFooter()}
      </main>

      ${renderPlayer()}
    </div>
  `;
}

function renderRouteContent(queryFilters, queryFilteredUrls) {
  if (state.route.path === "/") {
    return renderTagExplorer();
  }

  if (state.route.path === "/list") {
    return renderAlbumList(queryFilters, queryFilteredUrls);
  }

  return renderAdvancedLab(queryFilteredUrls);
}

function renderLicenseLegend() {
  const termItems = LICENSE_TERM_LEGEND.map((term) => {
    return `
      <li>
        <span class="license-legend__code">${escapeHtml(term.code)}</span>
        <span>${escapeHtml(term.meaning)}</span>
      </li>
    `;
  }).join("");

  return `
    <aside class="license-legend" aria-label="Creative Commons license shorthand">
      <p class="license-legend__intro">
        License shorthand appears on filters and album cards.
      </p>
      <ul class="license-legend__list">${termItems}</ul>
      <p class="license-legend__examples">
        Examples:
        <code>by-sa</code> = attribution + share-alike,
        <code>by-nc</code> = attribution + non-commercial.
      </p>
    </aside>
  `;
}

function renderTagExplorer() {
  if (state.loadingTags === "error") {
    return `<p class="status status--error">Tag index failed to load.</p>`;
  }

  if (state.loadingTags !== "loaded") {
    return `<p class="status status--loading">Loading tags...</p>`;
  }

  const visibleTags = state.tags.filter((tag) => {
    if (state.filterLowCount === "top" && tag.count < LOW_COUNT) return false;
    if (state.filterLowCount === "more" && tag.count < VERY_LOW_COUNT) return false;

    const query = state.debouncedTagSearch.toLowerCase();
    if (!query) return true;
    return String(tag.name || "").toLowerCase().includes(query);
  });

  const showMoreButton =
    state.filterLowCount !== "all"
      ? `<button class="ghost-button" data-action="show-more-tags">${
          state.filterLowCount === "more" ? "Show all tags" : "Show more tags"
        }</button>`
      : "";

  const licenseCards = LICENSES.map(
    (license) => `
      <a class="quick-card quick-card--license" href="${buildRoute("/list", {
        license: license.bc_id,
      })}">
        <span>${escapeHtml(license.name)}</span>
        <small>${formatCount(license.count)}</small>
      </a>
    `
  ).join("");

  const tagCards = visibleTags
    .map(
      (tag) => `
        <a class="tag-chip" href="${buildRoute("/list", { tag: tag.tag_id })}">
          <span class="tag-chip__name">${escapeHtml(tag.name)}</span>
          <span class="tag-chip__count">${formatCount(tag.count)}</span>
        </a>
      `
    )
    .join("");

  return `
    <div class="section-head">
      <h2>${BRAND.navDiscover}</h2>
      <p>Start broad with tags, then narrow by license and favorites.</p>
    </div>

    <form id="tag-search-form" class="search-form">
      <label class="field-label">
        Search tags
        <input
          id="tag-search-input"
          type="search"
          value="${escapeHtml(state.tagSearch)}"
          placeholder='ambient, "hip hop", field recordings'
        />
      </label>
    </form>

    <div class="quick-row">
      <a class="quick-card quick-card--fave" href="${buildRoute("/list", {
        faves: "true",
      })}">
        <span>Favorites</span>
        <small>editor picks</small>
      </a>
      ${licenseCards}
    </div>

    ${renderLicenseLegend()}

    <div class="chip-grid">
      ${tagCards}
    </div>

    ${showMoreButton}
  `;
}

function renderLicenseBadgeFilter(queryFilters) {
  const selectedTokens = new Set(
    getOptionalLicenseTokens(queryFilters.selectedLicenseCode)
  );
  const selectedCode = queryFilters.selectedLicenseCode || "";
  const requirements = getLicenseRequirementSummary(selectedCode);

  const badgeItems = LICENSE_BADGES.map((badge) => {
    const nextTokens = new Set(selectedTokens);

    if (nextTokens.has(badge.token)) {
      nextTokens.delete(badge.token);
    } else {
      nextTokens.add(badge.token);
    }

    const nextCode = composeLicenseCodeFromOptionalTokens(nextTokens);
    const isActive = selectedTokens.has(badge.token);

    if (!nextCode) {
      return `
        <span
          class="license-picker__badge is-disabled"
          aria-disabled="true"
          title="${escapeHtml(LICENSE_BADGE_HINT)}"
        >
          ${escapeHtml(badge.label)}
        </span>
      `;
    }

    const href = buildListRouteWithQueryPatch(state.route.query, {
      lic: nextTokens.size > 0 ? nextCode : null,
      license: null,
    });

    return `
      <a
        href="${href}"
        class="license-picker__badge ${isActive ? "is-active" : ""}"
        title="${escapeHtml(badge.requirement)}"
      >
        ${escapeHtml(badge.label)}
      </a>
    `;
  }).join("");

  const codeDisplay = selectedCode
    ? `<code>${escapeHtml(selectedCode)}</code>`
    : `<code>any by-*</code>`;

  return `
    <section class="license-picker" aria-label="License badge filter">
      <p class="license-picker__intro">
        Build an exact license filter. <strong>BY</strong> stays on.
      </p>
      <div class="license-picker__row">
        <span
          class="license-picker__badge license-picker__badge--locked is-active"
          aria-label="BY badge is always enabled"
          tabindex="0"
          title="${escapeHtml(LOCKED_BY_TOOLTIP)}"
        >
          BY
        </span>
        ${badgeItems}
      </div>
      <p class="license-picker__requirements">${escapeHtml(requirements)}</p>
      <p class="license-picker__code">Current code: ${codeDisplay}</p>
      <p class="license-picker__hint">${escapeHtml(LICENSE_BADGE_HINT)}</p>
    </section>
  `;
}

function renderAlbumList(queryFilters, queryFilteredUrls) {
  if (state.loadingTags === "error" || state.loadingUrls === "error") {
    return `<p class="status status--error">Album index failed to load.</p>`;
  }

  if (state.loadingTags !== "loaded" || state.loadingUrls !== "loaded") {
    return `<p class="status status--loading">Loading albums...</p>`;
  }

  const shuffledUrls = getShuffledUrls(queryFilteredUrls);
  const displayedUrls = state.listShowAll
    ? shuffledUrls
    : shuffledUrls.slice(0, LANDING_COUNT);

  const selectedLicense = queryFilters.selectedLicense;
  const selectedLicenseData = selectedLicense
    ? licenseById.get(selectedLicense)
    : undefined;

  const selectedLicenseDetails = selectedLicenseData
    ? `
      <div class="info-card info-card--license">
        <h3>Selected license: ${escapeHtml(selectedLicenseData.name)}</h3>
        <ul class="license-points">
          ${getLicenseDetails(selectedLicenseData.bc_id)
            .map((detail) => `<li>${escapeHtml(detail)}</li>`)
            .join("")}
        </ul>
        <p>
          <a class="inline-link" href="${escapeHtml(
            selectedLicenseData.url
          )}" target="_blank" rel="noreferrer">Read full license</a>
        </p>
      </div>
    `
    : "";

  const favoritesAbout = queryFilters.showingFaves
    ? `
      <div class="info-card info-card--faves">
        <h3>Favorites mode</h3>
        <p>Showing only favorited releases from the catalog.</p>
      </div>
    `
    : "";

  const hasResults = queryFilteredUrls.length > 0;
  const showAllButton =
    !state.listShowAll && queryFilteredUrls.length > LANDING_COUNT
      ? `<button class="ghost-button" data-action="show-all-list">Show all results</button>`
      : "";

  return `
    <a href="#/" class="inline-link">← Back to discover</a>

    <div class="section-head" style="margin-top: 12px;">
      <h2>${BRAND.navResults}</h2>
      <p>Matches from your current filters, shuffled for discovery.</p>
    </div>

    ${renderLicenseBadgeFilter(queryFilters)}

    <p class="result-meta"><strong>${formatCount(queryFilteredUrls.length)}</strong> matching albums</p>

    ${selectedLicenseDetails}
    ${favoritesAbout}
    <div class="results-license-legend">
      ${renderLicenseLegend()}
    </div>

    ${
      hasResults
        ? `<div class="album-grid">${displayedUrls
            .map((urlListing) => renderAlbumCard(urlListing, queryFilters))
            .join("")}</div>`
        : `<p class="status status--empty">No albums match these filters.</p>`
    }

    ${showAllButton}
  `;
}

function renderAlbumCard(urlListing, queryFilters) {
  const tagBadges = (urlListing.tags || [])
    .map((tagId) => {
      const tag = state.tagById.get(tagId);
      const activeClass = queryFilters.selectedTag === tagId ? "is-active" : "";
      const tagName = tag?.name || `tag:${tagId}`;

      return `
        <a href="${buildRoute("/list", { tag: tagId })}" class="badge badge--tag ${activeClass}">
          ${escapeHtml(tagName)}
        </a>
      `;
    })
    .join("");

  const licenseName = getLicenseNameById(urlListing.license) || "unknown";
  const licenseActiveClass =
    queryFilters.selectedLicense === urlListing.license ? "is-active" : "";

  return `
    <article class="album-card ${urlListing.favorite ? "album-card--fave" : ""}">
      <div class="album-card__top">
        <span class="album-star">${urlListing.favorite ? "★" : ""}</span>
        <a
          class="album-card__title"
          href="${escapeHtml(urlListing.url)}"
          target="_blank"
          rel="noreferrer"
        >
          ${escapeHtml(urlListing.title)}
        </a>
      </div>

      <div class="badge-row">${tagBadges}</div>

      <div class="badge-row">
        <a
          href="${buildRoute("/list", { license: urlListing.license })}"
          class="badge badge--license ${licenseActiveClass}"
        >
          ${escapeHtml(licenseName)}
        </a>
      </div>

      <button
        class="listen-btn ${urlListing.favorite ? "listen-btn--fave" : ""}"
        data-action="listen"
        data-url-id="${urlListing.url_id}"
      >
        Listen
      </button>
    </article>
  `;
}

function renderAdvancedLab(baseFilteredUrls) {
  if (state.loadingTags === "error" || state.loadingUrls === "error") {
    return `<p class="status status--error">Advanced filters failed to initialize.</p>`;
  }

  if (state.loadingTags !== "loaded" || state.loadingUrls !== "loaded") {
    return `<p class="status status--loading">Loading advanced filter data...</p>`;
  }

  const advancedFilteredUrls = filterUrlsAdvanced(baseFilteredUrls);
  const displayedUrls = state.advanced.showAll
    ? advancedFilteredUrls
    : advancedFilteredUrls.slice(0, SAMPLE_COUNT);

  const showAllButton =
    !state.advanced.showAll && advancedFilteredUrls.length > SAMPLE_COUNT
      ? `<button class="ghost-button" data-action="show-all-advanced">Show all results</button>`
      : "";

  return `
    <div class="section-head">
      <h2>${BRAND.navAdvanced}</h2>
      <p>Compose precise filters using tags, text terms, and license codes.</p>
    </div>

    <div class="rules-card">
      Enter terms in quotes, separated by commas.
      <ul>
        <li>Tags by name: <code>"indie","hip hop"</code></li>
        <li>Strings match title + url: <code>"Boards","Canada"</code></li>
        <li>License by abbreviation: <code>"by-nc-nd","by"</code></li>
      </ul>
    </div>

    ${renderLicenseLegend()}

    <form id="advanced-form" class="advanced-form">
      <label class="field-label">
        Include tags (AND)
        <input id="advanced-include-tags" type="text" value="${escapeHtml(
          state.advanced.inputs.includeTags
        )}" />
      </label>

      <label class="field-label">
        Exclude tags (OR)
        <input id="advanced-exclude-tags" type="text" value="${escapeHtml(
          state.advanced.inputs.excludeTags
        )}" />
      </label>

      <label class="field-label">
        Include strings (AND)
        <input id="advanced-include-string" type="text" value="${escapeHtml(
          state.advanced.inputs.includeString
        )}" />
      </label>

      <label class="field-label">
        Exclude strings (OR)
        <input id="advanced-exclude-string" type="text" value="${escapeHtml(
          state.advanced.inputs.excludeString
        )}" />
      </label>

      <label class="field-label">
        Include license (OR)
        <input id="advanced-include-license" type="text" value="${escapeHtml(
          state.advanced.inputs.includeLicense
        )}" />
      </label>

      <label class="checkbox-field">
        <input
          id="advanced-cap-urls"
          type="checkbox"
          ${state.advanced.inputs.capUrlsPerAccount ? "checked" : ""}
        />
        <span>Cap listings (${URL_CAP} per account)</span>
      </label>

      <button class="solid-button" type="submit">Apply filters</button>
    </form>

    <button class="outline-button" data-action="random-advanced">Open random match</button>

    <hr class="divider" />

    <p class="result-meta"><strong>${formatCount(
      advancedFilteredUrls.length
    )}</strong> results</p>

    ${
      advancedFilteredUrls.length > 0
        ? `<div class="advanced-card-grid">${displayedUrls
            .map((urlListing) => renderAdvancedCard(urlListing))
            .join("")}</div>`
        : `<p class="status status--empty">No listings match the current advanced rules.</p>`
    }

    ${showAllButton}
  `;
}

function renderAdvancedCard(urlListing) {
  const tagNames = (urlListing.tags || [])
    .map((tagId) => state.tagById.get(tagId)?.name)
    .filter(Boolean)
    .join(", ");

  return `
    <article class="advanced-card">
      <ul>
        <li><strong>Title:</strong> ${escapeHtml(urlListing.title)}</li>
        <li>
          <strong>URL:</strong>
          <a href="${escapeHtml(urlListing.url)}" target="_blank" rel="noreferrer">${escapeHtml(
            urlListing.url
          )}</a>
        </li>
        <li><strong>Tags:</strong> ${escapeHtml(tagNames || "none")}</li>
        <li>
          <strong>License:</strong>
          ${escapeHtml(getLicenseNameById(urlListing.license) || "unknown")}
        </li>
      </ul>
    </article>
  `;
}

function renderFooter() {
  if (state.loadingTags !== "loaded" || state.loadingUrls !== "loaded") {
    return `
      <footer class="site-footer">
        <a href="https://github.com/handeyeco/cc-bc" target="_blank" rel="noreferrer">Original dataset project</a>
        <span>Loading music index...</span>
      </footer>
    `;
  }

  return `
    <footer class="site-footer">
      <a href="https://github.com/handeyeco/cc-bc" target="_blank" rel="noreferrer">Original dataset project</a>
      <span>${formatCount(state.urls.length)} albums · ${formatCount(
        state.tags.length
      )} tags · maintained by wagenhoffer.dev</span>
    </footer>
  `;
}

function renderPlayer() {
  if (!state.playerData?.bc_id) return "";

  return `
    <div class="sticky-player">
      <iframe
        title="Bandcamp album preview"
        src="https://bandcamp.com/EmbeddedPlayer/album=${state.playerData.bc_id}/size=small/bgcol=ffffff/linkcol=0f7d9b/transparent=true/"
        seamless
      >
        <a href="${escapeHtml(state.playerData.url)}">${escapeHtml(
          state.playerData.title
        )}</a>
      </iframe>
    </div>
  `;
}

function handleAppClick(event) {
  const actionEl = event.target.closest("[data-action]");
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  if (action === "random-global") {
    event.preventDefault();
    handleRandomGlobal();
    return;
  }

  if (action === "show-more-tags") {
    event.preventDefault();

    if (state.filterLowCount === "top") {
      state.filterLowCount = "more";
    } else if (state.filterLowCount === "more") {
      state.filterLowCount = "all";
    }

    render();
    return;
  }

  if (action === "show-all-list") {
    event.preventDefault();
    state.listShowAll = true;
    render();
    return;
  }

  if (action === "listen") {
    event.preventDefault();
    const urlId = Number(actionEl.dataset.urlId);
    if (!Number.isFinite(urlId)) return;

    const listing = state.urlById.get(urlId);
    if (!listing) return;

    state.playerData = {
      title: listing.title,
      url: listing.url,
      bc_id: listing.bc_id,
    };
    render();
    return;
  }

  if (action === "random-advanced") {
    event.preventDefault();
    handleRandomAdvanced();
    return;
  }

  if (action === "show-all-advanced") {
    event.preventDefault();
    state.advanced.showAll = true;
    render();
  }
}

function handleAppSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  if (form.id === "tag-search-form") {
    event.preventDefault();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    return;
  }

  if (form.id === "advanced-form") {
    event.preventDefault();
    state.advanced.filters = { ...state.advanced.inputs };
    state.advanced.showAll = false;
    render();
  }
}

function handleAppInput(event) {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;

  if (target.id === "tag-search-input") {
    state.tagSearch = target.value;

    if (state.tagDebounceTimer) {
      clearTimeout(state.tagDebounceTimer);
    }

    state.tagDebounceTimer = setTimeout(() => {
      const previous = state.debouncedTagSearch;
      const next = state.tagSearch.trim();

      if (!next && previous) {
        state.filterLowCount = "top";
      } else if (next && !previous) {
        state.filterLowCount = "all";
      }

      state.debouncedTagSearch = next;
      render();
    }, 350);

    return;
  }

  if (target.id === "advanced-include-tags") {
    state.advanced.inputs.includeTags = target.value;
    return;
  }

  if (target.id === "advanced-exclude-tags") {
    state.advanced.inputs.excludeTags = target.value;
    return;
  }

  if (target.id === "advanced-include-string") {
    state.advanced.inputs.includeString = target.value;
    return;
  }

  if (target.id === "advanced-exclude-string") {
    state.advanced.inputs.excludeString = target.value;
    return;
  }

  if (target.id === "advanced-include-license") {
    state.advanced.inputs.includeLicense = target.value;
    return;
  }

  if (target.id === "advanced-cap-urls") {
    state.advanced.inputs.capUrlsPerAccount = target.checked;
  }
}

function handleRandomGlobal() {
  if (state.loadingUrls !== "loaded") return;

  const queryFilters = getQueryFilters(state.route.query);
  const queryFilteredUrls = filterUrlsByQuery(state.urls, queryFilters);
  openRandomUrl(collapseUrls(queryFilteredUrls));
}

function handleRandomAdvanced() {
  if (state.loadingUrls !== "loaded") return;

  const queryFilters = getQueryFilters(state.route.query);
  const queryFilteredUrls = filterUrlsByQuery(state.urls, queryFilters);
  const advancedFilteredUrls = filterUrlsAdvanced(queryFilteredUrls);
  openRandomUrl(collapseUrls(advancedFilteredUrls));
}

function openRandomUrl(urls) {
  if (!urls.length) return;

  const randomIndex = Math.floor(Math.random() * urls.length);
  const listing = urls[randomIndex];
  if (!listing?.url) return;

  window.open(listing.url, "_blank", "noopener");
}

function normalizeLicenseCode(value) {
  if (value == null) return null;

  const tokens = String(value)
    .toLowerCase()
    .replace(/_/g, "-")
    .split("-")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0 || tokens[0] !== "by") {
    return null;
  }

  const seen = new Set();
  for (const token of tokens.slice(1)) {
    if (!LICENSE_BADGE_ORDER.includes(token) || seen.has(token)) {
      return null;
    }
    seen.add(token);
  }

  const canonicalCode = [
    "by",
    ...LICENSE_BADGE_ORDER.filter((token) => seen.has(token)),
  ].join("-");

  if (!STANDARD_LICENSE_CODES.has(canonicalCode)) {
    return null;
  }

  return canonicalCode;
}

function getOptionalLicenseTokens(licenseCode) {
  const normalizedCode = normalizeLicenseCode(licenseCode);
  if (!normalizedCode) return [];

  return normalizedCode
    .split("-")
    .slice(1)
    .filter((token) => LICENSE_BADGE_ORDER.includes(token));
}

function composeLicenseCodeFromOptionalTokens(optionalTokens) {
  const selectedTokens = new Set(optionalTokens);
  const candidate = [
    "by",
    ...LICENSE_BADGE_ORDER.filter((token) => selectedTokens.has(token)),
  ].join("-");

  return normalizeLicenseCode(candidate);
}

function getLicenseRequirementSummary(selectedLicenseCode) {
  const normalizedCode = normalizeLicenseCode(selectedLicenseCode);
  const optionalTokens = getOptionalLicenseTokens(selectedLicenseCode);
  const baseTokenList =
    optionalTokens.length > 0 ? ["by", ...optionalTokens] : ["by"];
  const details = baseTokenList
    .map((token) => LICENSE_EXPLANATIONS[token] || token)
    .join("; ");

  const sentence = details.charAt(0).toUpperCase() + details.slice(1);
  if (optionalTokens.length === 0) {
    if (normalizedCode === "by") {
      return `${sentence}.`;
    }
    return `${sentence}. Add NC, SA, or ND to narrow results.`;
  }

  return `${sentence}.`;
}

function getQueryFilters(query) {
  const selectedLicenseCodeFromRoute = normalizeLicenseCode(query.get("lic"));
  let selectedLicense = null;
  let selectedLicenseCode = null;

  if (selectedLicenseCodeFromRoute) {
    if (selectedLicenseCodeFromRoute !== "by") {
      selectedLicenseCode = selectedLicenseCodeFromRoute;
      selectedLicense =
        licenseByName.get(selectedLicenseCodeFromRoute)?.bc_id ?? null;
    }
  } else {
    const legacyLicense = parseMaybeNumber(query.get("license"));
    if (legacyLicense != null && licenseById.has(legacyLicense)) {
      selectedLicense = legacyLicense;
      selectedLicenseCode = normalizeLicenseCode(getLicenseNameById(legacyLicense));
    }
  }

  const selectedTag = parseMaybeNumber(query.get("tag"));
  const showingFaves = query.has("faves");

  return {
    selectedLicenseCode,
    selectedLicense,
    selectedTag,
    showingFaves,
  };
}

function parseMaybeNumber(value) {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function filterUrlsByQuery(urls, queryFilters) {
  let filtered = urls;

  if (queryFilters.selectedLicense != null) {
    filtered = filtered.filter((urlListing) => {
      return urlListing.license === queryFilters.selectedLicense;
    });
  }

  if (queryFilters.selectedTag != null) {
    filtered = filtered.filter((urlListing) => {
      return (urlListing.tags || []).includes(queryFilters.selectedTag);
    });
  }

  if (queryFilters.showingFaves) {
    filtered = filtered.filter((urlListing) => Boolean(urlListing.favorite));
  }

  return filtered;
}

function getShuffledUrls(filteredUrls) {
  const key = `${state.route.path}?${state.route.query.toString()}`;

  if (state.listCache.key !== key) {
    state.listCache.key = key;
    state.listCache.shuffled = filteredUrls.slice();
    shuffleInPlace(state.listCache.shuffled);
    state.listShowAll = false;
  }

  return state.listCache.shuffled;
}

function shuffleInPlace(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const randomIndex = Math.floor(Math.random() * (i + 1));
    [list[i], list[randomIndex]] = [list[randomIndex], list[i]];
  }
}

function getRandomButtonLabel(queryFilters, queryFilteredUrls) {
  if (state.loadingUrls !== "loaded") {
    return "Loading catalog...";
  }

  if (queryFilteredUrls.length === 0) {
    return "No matching albums";
  }

  if (queryFilteredUrls.length === state.urls.length) {
    return "Open a random album";
  }

  if (queryFilters.selectedTag != null) {
    const tag = state.tagById.get(queryFilters.selectedTag);
    if (tag) {
      return `Open random \"${tag.name}\" album`;
    }
  }

  if (queryFilters.selectedLicense != null) {
    const licenseName = getLicenseNameById(queryFilters.selectedLicense);
    if (licenseName) {
      return `Open random \"${licenseName}\" album`;
    }
  }

  if (queryFilters.showingFaves) {
    return "Open random favorite album";
  }

  return "Open random filtered album";
}

function collapseUrls(urls, limit = 5) {
  const bandcampSubdomainRegex = /^https?:\/\/(.+)\.bandcamp\.com/i;
  const counts = Object.create(null);

  return urls.filter((urlListing) => {
    const match = String(urlListing.url || "").match(bandcampSubdomainRegex);
    if (!match) return false;

    const subdomain = match[1].toLowerCase();
    counts[subdomain] = (counts[subdomain] || 0) + 1;

    return counts[subdomain] <= limit;
  });
}

function filterUrlsAdvanced(urls) {
  const filters = state.advanced.filters;

  if (
    !filters.includeTags &&
    !filters.excludeTags &&
    !filters.includeString &&
    !filters.excludeString &&
    !filters.includeLicense &&
    !filters.capUrlsPerAccount
  ) {
    return urls;
  }

  let prefilteredUrls = urls;

  if (filters.capUrlsPerAccount) {
    const byOriginCount = new Map();
    const cappedUrls = [];

    for (const urlListing of urls) {
      let origin;
      try {
        origin = new URL(urlListing.url).origin;
      } catch {
        continue;
      }

      const count = byOriginCount.get(origin) || 0;
      if (count < URL_CAP) {
        byOriginCount.set(origin, count + 1);
        cappedUrls.push(urlListing);
      }
    }

    prefilteredUrls = cappedUrls;
  }

  return prefilteredUrls.filter((urlListing) => {
    if (filters.includeLicense) {
      const terms = splitTerms(filters.includeLicense);
      const ids = terms
        .map((term) => licenseByName.get(term)?.bc_id)
        .filter((id) => id != null);

      if (!ids.includes(urlListing.license)) {
        return false;
      }
    }

    if (filters.includeString) {
      const terms = splitTerms(filters.includeString);
      for (const term of terms) {
        if (
          !String(urlListing.title || "").toLowerCase().includes(term) &&
          !String(urlListing.url || "").toLowerCase().includes(term)
        ) {
          return false;
        }
      }
    }

    if (filters.excludeString) {
      const terms = splitTerms(filters.excludeString);
      for (const term of terms) {
        if (
          String(urlListing.title || "").toLowerCase().includes(term) ||
          String(urlListing.url || "").toLowerCase().includes(term)
        ) {
          return false;
        }
      }
    }

    if (filters.includeTags) {
      const terms = splitTerms(filters.includeTags);
      for (const term of terms) {
        const tag = state.tagByName.get(term);
        if (tag && !(urlListing.tags || []).includes(tag.tag_id)) {
          return false;
        }
      }
    }

    if (filters.excludeTags) {
      const terms = splitTerms(filters.excludeTags);
      for (const term of terms) {
        const tag = state.tagByName.get(term);
        if (tag && (urlListing.tags || []).includes(tag.tag_id)) {
          return false;
        }
      }
    }

    return true;
  });
}

function splitTerms(input) {
  return String(input)
    .split(/\s*,\s*/)
    .map((token) => token.replace(/(^"|"$)/g, "").toLowerCase())
    .filter(Boolean);
}

function getLicenseNameById(licenseId) {
  return licenseById.get(licenseId)?.name;
}

function getLicenseDetails(licenseId) {
  const licenseName = getLicenseNameById(licenseId);
  if (!licenseName) return [];

  return licenseName.split("-").map((token) => {
    const explanation = LICENSE_EXPLANATIONS[token] || "custom term";
    return `${token}: ${explanation}`;
  });
}

function buildListRouteWithQueryPatch(baseQuery, patch) {
  const nextQuery = new URLSearchParams(baseQuery);

  for (const [key, value] of Object.entries(patch)) {
    if (value == null || value === false || value === "") {
      nextQuery.delete(key);
      continue;
    }

    nextQuery.set(key, String(value));
  }

  return buildRoute("/list", nextQuery);
}

function buildRoute(path, params) {
  const query = new URLSearchParams();

  if (params instanceof URLSearchParams) {
    params.forEach((value, key) => {
      query.set(key, value);
    });
  } else if (params && typeof params === "object") {
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === false || value === "") continue;
      query.set(key, String(value));
    }
  }

  const queryString = query.toString();
  return `#${path}${queryString ? `?${queryString}` : ""}`;
}

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

function escapeHtml(value) {
  const stringValue = String(value ?? "");
  return stringValue
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
