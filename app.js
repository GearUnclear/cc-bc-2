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
const BY_BADGE_TOOLTIP =
  "Attribution is required for all standard Creative Commons licenses.";
const ALL_LICENSE_SELECTION = "all";
const DEFAULT_RESULTS_LICENSE_SELECTION = ALL_LICENSE_SELECTION;
const STANDARD_LICENSE_CODES = new Set(
  LICENSES.map((license) => license.name.toLowerCase())
);

const LOW_COUNT = 200;
const VERY_LOW_COUNT = 10;
const LANDING_COUNT = 10;
const SAMPLE_COUNT = 5;
const URL_CAP = 10;
const ROUTES = new Set(["/", "/list"]);

const licenseById = new Map(LICENSES.map((license) => [license.bc_id, license]));
const licenseByName = new Map(
  LICENSES.map((license) => [license.name.toLowerCase(), license])
);

const appEl = document.getElementById("app");

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
  listLicenseSelection: DEFAULT_RESULTS_LICENSE_SELECTION,
  listTextSearch: "",
  debouncedListTextSearch: "",
  listTextSearchTimer: null,
  listSelectedTagIds: [],
  listTagSearchInput: "",
  listTagSuggestions: [],
  listTagSuggestionsVisible: false,
  listCapPerArtist: false,

  listCache: {
    key: "",
    shuffled: [],
  },
};

init();

function init() {
  if (!appEl) return;

  appEl.addEventListener("click", handleAppClick);
  appEl.addEventListener("submit", handleAppSubmit);
  appEl.addEventListener("input", handleAppInput);
  document.addEventListener("click", handleDocumentClick);
  window.addEventListener("hashchange", onRouteChange);

  onRouteChange();
  loadTags();
  loadUrls();
}

function onRouteChange() {
  state.route = parseRoute();

  if (state.route.path === "/list") {
    const explicitSelection = getLicenseSelectionFromQuery(state.route.query);
    if (explicitSelection) {
      state.listLicenseSelection = explicitSelection;
    }

    const tagParam = parseMaybeNumber(state.route.query.get("tag"));
    if (tagParam != null && !state.listSelectedTagIds.includes(tagParam)) {
      state.listSelectedTagIds = [tagParam];
    }
  }

  state.listShowAll = false;
  state.listTextSearch = "";
  state.debouncedListTextSearch = "";
  state.listTagSearchInput = "";
  state.listTagSuggestions = [];
  state.listTagSuggestionsVisible = false;
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

  return renderAlbumList(queryFilters, queryFilteredUrls);
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
        lic: license.name,
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
  const selectedLicenseSelection =
    queryFilters.selectedLicenseSelection || DEFAULT_RESULTS_LICENSE_SELECTION;
  const selectedCode =
    selectedLicenseSelection === ALL_LICENSE_SELECTION
      ? null
      : selectedLicenseSelection;
  const selectedTokens = new Set(
    selectedCode ? getOptionalLicenseTokens(selectedCode) : []
  );
  const requirements = getLicenseRequirementSummary(selectedLicenseSelection);
  const isByActive =
    selectedCode != null && normalizeLicenseCode(selectedCode) != null;

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
      lic: nextCode,
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

  const allHref = buildListRouteWithQueryPatch(state.route.query, {
    lic: ALL_LICENSE_SELECTION,
    license: null,
  });
  const byHref = buildListRouteWithQueryPatch(state.route.query, {
    lic: "by",
    license: null,
  });
  const codeDisplay =
    selectedLicenseSelection === ALL_LICENSE_SELECTION
      ? `<code>all</code>`
      : `<code>${escapeHtml(selectedLicenseSelection)}</code>`;

  return `
    <section class="license-picker" aria-label="License badge filter">
      <p class="license-picker__intro">
        Choose <strong>ALL</strong> or an exact Creative Commons license code.
      </p>
      <div class="license-picker__row">
        <a
          href="${allHref}"
          class="license-picker__badge ${
            selectedLicenseSelection === ALL_LICENSE_SELECTION ? "is-active" : ""
          }"
          title="Show all Creative Commons licenses"
        >
          ALL
        </a>
        <a
          href="${byHref}"
          class="license-picker__badge ${
            isByActive ? "is-active" : ""
          }"
          title="${escapeHtml(BY_BADGE_TOOLTIP)}"
        >
          BY
        </a>
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

  let listFiltered = queryFilteredUrls;
  listFiltered = applyListTagFilter(listFiltered);
  listFiltered = applyListTextSearch(listFiltered);
  if (state.listCapPerArtist) {
    listFiltered = collapseUrls(listFiltered, URL_CAP);
  }

  const shuffledUrls = getShuffledUrls(listFiltered, queryFilters);
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

  const hasResults = listFiltered.length > 0;
  const showAllButton =
    !state.listShowAll && listFiltered.length > LANDING_COUNT
      ? `<button class="ghost-button" data-action="show-all-list">Show all results</button>`
      : "";

  return `
    <a href="#/" class="inline-link">← Back to discover</a>

    <div class="section-head" style="margin-top: 12px;">
      <h2>${BRAND.navResults}</h2>
      <p>Matches from your current filters, shuffled for discovery.</p>
    </div>

    ${renderLicenseBadgeFilter(queryFilters)}

    ${renderListTextSearch()}
    ${renderListTagFilter()}
    ${renderListCapToggle()}

    <p class="result-meta"><strong>${formatCount(listFiltered.length)}</strong> matching albums</p>

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
  const normalizedLicenseCode = normalizeLicenseCode(licenseName);
  const licenseHref = normalizedLicenseCode
    ? buildRoute("/list", { lic: normalizedLicenseCode })
    : buildRoute("/list", { license: urlListing.license });
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
          href="${licenseHref}"
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

function renderListTextSearch() {
  return `
    <div class="list-filter-section">
      <label class="field-label">
        Search by title or URL
        <input
          id="list-text-search"
          type="search"
          value="${escapeHtml(state.listTextSearch)}"
          placeholder="Search albums..."
        />
      </label>
    </div>
  `;
}

function renderTagSuggestionsHTML() {
  if (!state.listTagSuggestionsVisible) return "";
  return `
      <ul class="tag-autocomplete__list">
        ${state.listTagSuggestions
          .map(
            (tag) => `
            <li
              class="tag-autocomplete__option"
              data-action="select-list-tag"
              data-tag-id="${tag.tag_id}"
            >
              ${escapeHtml(tag.name)}
              <span class="tag-autocomplete__count">${formatCount(tag.count)}</span>
            </li>
          `
          )
          .join("")}
        ${state.listTagSuggestions.length === 0 ? `<li class="tag-autocomplete__option tag-autocomplete__option--empty">No matching tags</li>` : ""}
      </ul>
    `;
}

function renderListTagFilter() {
  const selectedBadges = state.listSelectedTagIds
    .map((tagId) => {
      const tag = state.tagById.get(tagId);
      if (!tag) return "";
      return `
        <span class="filter-tag-badge">
          ${escapeHtml(tag.name)}
          <button
            class="filter-tag-badge__remove"
            data-action="remove-list-tag"
            data-tag-id="${tagId}"
            aria-label="Remove ${escapeHtml(tag.name)}"
          >&times;</button>
        </span>
      `;
    })
    .join("");

  const suggestions = renderTagSuggestionsHTML();

  return `
    <div class="list-filter-section tag-autocomplete">
      <label class="field-label">
        Filter by tags
        <input
          id="list-tag-search"
          type="search"
          value="${escapeHtml(state.listTagSearchInput)}"
          placeholder="Type to search tags..."
          autocomplete="off"
        />
      </label>
      ${suggestions}
      ${selectedBadges ? `<div class="filter-tag-badges">${selectedBadges}</div>` : ""}
    </div>
  `;
}

function renderListCapToggle() {
  return `
    <div class="list-filter-section">
      <label class="checkbox-field">
        <input
          id="list-cap-toggle"
          type="checkbox"
          ${state.listCapPerArtist ? "checked" : ""}
        />
        <span>Limit to ${URL_CAP} albums per artist</span>
      </label>
      <p class="cap-toggle-hint">Some Bandcamp accounts have many releases. Enable this to see a wider variety of artists.</p>
    </div>
  `;
}

function applyListTagFilter(urls) {
  if (state.listSelectedTagIds.length === 0) return urls;

  return urls.filter((urlListing) => {
    const tags = urlListing.tags || [];
    return state.listSelectedTagIds.every((tagId) => tags.includes(tagId));
  });
}

function applyListTextSearch(urls) {
  const query = state.debouncedListTextSearch.toLowerCase();
  if (!query) return urls;

  return urls.filter((urlListing) => {
    return (
      String(urlListing.title || "").toLowerCase().includes(query) ||
      String(urlListing.url || "").toLowerCase().includes(query)
    );
  });
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

function handleDocumentClick(event) {
  if (state.listTagSuggestionsVisible) {
    const autocomplete = document.querySelector(".tag-autocomplete");
    if (autocomplete && !autocomplete.contains(event.target)) {
      state.listTagSuggestionsVisible = false;
      state.listTagSuggestions = [];
      render();
    }
  }
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

  if (action === "select-list-tag") {
    event.preventDefault();
    const tagId = Number(actionEl.dataset.tagId);
    if (Number.isFinite(tagId) && !state.listSelectedTagIds.includes(tagId)) {
      state.listSelectedTagIds = [...state.listSelectedTagIds, tagId];
      state.listTagSearchInput = "";
      state.listTagSuggestions = [];
      state.listTagSuggestionsVisible = false;
      state.listCache.key = "";
      state.listShowAll = false;
      render();
      const input = document.getElementById("list-tag-search");
      if (input) input.focus();
    }
    return;
  }

  if (action === "remove-list-tag") {
    event.preventDefault();
    const tagId = Number(actionEl.dataset.tagId);
    if (Number.isFinite(tagId)) {
      state.listSelectedTagIds = state.listSelectedTagIds.filter(
        (id) => id !== tagId
      );
      state.listCache.key = "";
      state.listShowAll = false;
      render();
    }
    return;
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

  if (target.id === "list-text-search") {
    state.listTextSearch = target.value;

    if (state.listTextSearchTimer) {
      clearTimeout(state.listTextSearchTimer);
    }

    state.listTextSearchTimer = setTimeout(() => {
      state.debouncedListTextSearch = state.listTextSearch.trim();
      state.listCache.key = "";
      state.listShowAll = false;
      render();
      const input = document.getElementById("list-text-search");
      if (input) input.focus();
    }, 350);

    return;
  }

  if (target.id === "list-tag-search") {
    state.listTagSearchInput = target.value;
    const query = target.value.trim().toLowerCase();

    if (query) {
      const excluded = new Set(state.listSelectedTagIds);
      state.listTagSuggestions = state.tags
        .filter(
          (tag) =>
            !excluded.has(tag.tag_id) &&
            String(tag.name || "").toLowerCase().includes(query)
        )
        .slice(0, 10);
      state.listTagSuggestionsVisible = true;
    } else {
      state.listTagSuggestions = [];
      state.listTagSuggestionsVisible = false;
    }

    const container = document.querySelector(".tag-autocomplete");
    if (container) {
      const oldList = container.querySelector(".tag-autocomplete__list");
      if (oldList) oldList.remove();
      const html = renderTagSuggestionsHTML();
      if (html) {
        container.querySelector("label").insertAdjacentHTML("afterend", html);
      }
    }
    return;
  }

  if (target.id === "list-cap-toggle") {
    state.listCapPerArtist = target.checked;
    state.listCache.key = "";
    state.listShowAll = false;
    render();
  }
}

function handleRandomGlobal() {
  if (state.loadingUrls !== "loaded") return;

  const queryFilters = getQueryFilters(state.route.query);
  let filtered = filterUrlsByQuery(state.urls, queryFilters);

  if (state.route.path === "/list") {
    filtered = applyListTagFilter(filtered);
    filtered = applyListTextSearch(filtered);
    if (state.listCapPerArtist) {
      filtered = collapseUrls(filtered, URL_CAP);
    }
  }

  openRandomUrl(collapseUrls(filtered));
}

function openRandomUrl(urls) {
  if (!urls.length) return;

  const randomIndex = Math.floor(Math.random() * urls.length);
  const listing = urls[randomIndex];
  if (!listing?.url) return;

  window.open(listing.url, "_blank", "noopener");
}

function normalizeLicenseSelection(value) {
  if (value == null) return null;
  const normalizedValue = String(value).trim().toLowerCase();
  if (!normalizedValue) return null;
  if (normalizedValue === ALL_LICENSE_SELECTION) {
    return ALL_LICENSE_SELECTION;
  }

  return normalizeLicenseCode(normalizedValue);
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

function getLicenseSelectionFromQuery(query) {
  const selectedLicenseFromQuery = normalizeLicenseSelection(query.get("lic"));
  if (selectedLicenseFromQuery) {
    return selectedLicenseFromQuery;
  }

  const legacyLicense = parseMaybeNumber(query.get("license"));
  if (legacyLicense != null && licenseById.has(legacyLicense)) {
    return normalizeLicenseCode(getLicenseNameById(legacyLicense));
  }

  return null;
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

function getLicenseRequirementSummary(selectedLicenseSelection) {
  if (
    selectedLicenseSelection == null ||
    selectedLicenseSelection === ALL_LICENSE_SELECTION
  ) {
    return "Showing all Creative Commons license types.";
  }

  const normalizedCode = normalizeLicenseCode(selectedLicenseSelection);
  if (!normalizedCode) {
    return "Showing all Creative Commons license types.";
  }

  const details = normalizedCode
    .split("-")
    .map((token) => LICENSE_EXPLANATIONS[token] || token)
    .join("; ");
  const sentence = details.charAt(0).toUpperCase() + details.slice(1);
  return `${sentence}.`;
}

function getQueryFilters(query, routePath = state.route.path) {
  const explicitSelection = getLicenseSelectionFromQuery(query);
  let selectedLicenseSelection = explicitSelection;
  let selectedLicense = null;
  let selectedLicenseCode = null;

  if (!selectedLicenseSelection && routePath === "/list") {
    selectedLicenseSelection =
      state.listLicenseSelection || DEFAULT_RESULTS_LICENSE_SELECTION;
  }

  if (
    selectedLicenseSelection &&
    selectedLicenseSelection !== ALL_LICENSE_SELECTION
  ) {
    selectedLicenseCode = selectedLicenseSelection;
    selectedLicense =
      licenseByName.get(selectedLicenseSelection)?.bc_id ?? null;
  }

  const selectedTag = parseMaybeNumber(query.get("tag"));
  const showingFaves = query.has("faves");

  return {
    selectedLicenseSelection,
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

function getShuffledUrls(filteredUrls, queryFilters) {
  const licenseSelection = queryFilters?.selectedLicenseSelection || "";
  const key = `${state.route.path}?${state.route.query.toString()}&__lic=${licenseSelection}&__txt=${state.debouncedListTextSearch}&__tags=${state.listSelectedTagIds.join(",")}&__cap=${state.listCapPerArtist}`;

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
