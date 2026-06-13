# Gate 2 — Page-Type (Commerce) Detection — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Gate 2 — suppress *document-like* pages whose archetype makes their numbers transactional/comparative (retail, real-estate, travel, menus) — the pages Gate 1's app-vs-document heuristics let through (e.g. a prose-rich IKEA or Zillow listing).

**Architecture:** A page-level check `isCommercePage(document)` added to `lib/gates.js`, slotted into `evaluatePage` **after** Gate 1's hostname list and **before** Gate 1's heuristics, returning `suppress('gate2-commerce')`. Detection is structured-data-first (JSON-LD `@type`, schema.org microdata, OpenGraph `og:type`) with a small hostname net for real-estate SPAs that ship no usable markup. An explicit article declaration (`og:type=article` or a JSON-LD `Article`/`NewsArticle` type) always wins → the page runs, so a news article that merely *quotes* a price isn't suppressed.

**Tech Stack:** Vanilla JS (classic IIFE on `window.BallparkGates`), `node --test` + `jsdom`. No new files, no new manifest permissions, no version bump (ships in the same combined **1.1.0** submission as Gate 1, which was never submitted).

## Design (agreed in brainstorm — no separate spec doc)

- **Job:** page-level archetype gate for document-like pages with transactional/comparative numbers. Gate 1 already catches *app-like* surfaces (social/maps/sports interfaces via control density); Gate 2 catches the *prose-rich* commerce/listing pages Gate 1 runs.
- **Detection, in order** (`isCommercePage`):
  1. **Article guard (wins):** `og:type=article` OR JSON-LD top-level `@type` ∈ article types → `false` (runs). Keeps news/reviews that quote prices.
  2. **Hostname net:** real-estate SPAs (zillow, apartments.com, apartmentlist, redfin, trulia, realtor, hotpads) → `true`.
  3. **OpenGraph:** `og:type` starts with `product` → `true`.
  4. **JSON-LD:** any top-level `@type` ∈ commerce types → `true`.
  5. **Microdata:** any `[itemscope][itemtype]` whose bare type ∈ commerce types → `true`.
  6. else `false`.
- **`JobPosting` is NOT a commerce type** → salary pages run (the doc's flagged keep case).
- **gate id / reason:** `gate2-commerce` / "Looks like a shopping, listing, or booking page." Override-recoverable like every gate (the toggle means detection needn't be perfect).
- **Out of scope (v1):** social/maps/sports fuzzy detection (mostly Gate 1's already), and DOM-pattern scraping (cart buttons, price regex).

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `lib/gates.js` | `isCommercePage` + helpers; funnel insertion; `gate2-commerce` reason | Modify |
| `test/gates.test.js` | Unit tests for Gate 2 detection + precision guards | Modify |
| `test/fixtures/pages/*.html` + `page-labels.json` | Corpus: product-JSON-LD, article-quotes-price, promote real-estate | Modify |
| `CLAUDE.md` | Note Gate 2 under "Where to make changes" | Modify |

---

## Task 1: Gate 2 detection + funnel wiring

**Files:**
- Modify: `lib/gates.js`
- Modify: `test/gates.test.js`

- [ ] **Step 1: Write the failing unit tests**

In `test/gates.test.js`, after the `applyOverride` test, add a shared helper and two test blocks:

```js
// Evaluate a raw HTML string (optionally at a given url) through the gates.
function decideHtml(html, url) {
  const opts = { runScripts: 'outside-only' };
  if (url) opts.url = url;
  const dom = new JSDOM(html, opts);
  dom.window.eval(GATES_SRC);
  return dom.window.BallparkGates.evaluatePage(dom.window.document);
}

// Prose-rich body so Gate 1 would RUN — isolates Gate 2's effect.
const G2_PROSE = '<main><article><p>' + 'word '.repeat(60) + '</p></article></main>';

test('Gate 2 suppresses commerce archetypes (structured data + hostname net)', () => {
  const product = decideHtml(
    `<!DOCTYPE html><body>${G2_PROSE}<script type="application/ld+json">{"@type":"Product","name":"Sofa"}</script></body>`
  );
  assert.equal(product.gate, 'gate2-commerce', 'Product JSON-LD');

  const og = decideHtml(
    `<!DOCTYPE html><head><meta property="og:type" content="product"></head><body>${G2_PROSE}</body>`
  );
  assert.equal(og.gate, 'gate2-commerce', 'og:type=product');

  const micro = decideHtml(
    `<!DOCTYPE html><body>${G2_PROSE}<div itemscope itemtype="https://schema.org/Product"></div></body>`
  );
  assert.equal(micro.gate, 'gate2-commerce', 'Product microdata');

  const graph = decideHtml(
    `<!DOCTYPE html><body>${G2_PROSE}<script type="application/ld+json">{"@graph":[{"@type":"WebPage"},{"@type":"RealEstateListing"}]}</script></body>`
  );
  assert.equal(graph.gate, 'gate2-commerce', '@graph nested type');

  const re = decideHtml(`<!DOCTYPE html><body>${G2_PROSE}</body>`, 'https://www.zillow.com/homes/123');
  assert.equal(re.gate, 'gate2-commerce', 'real-estate SPA hostname net');
});

test('Gate 2 keeps articles and job postings running (precision guards)', () => {
  // og:type=article wins even with a Product block present.
  const article = decideHtml(
    `<!DOCTYPE html><head><meta property="og:type" content="article"></head><body>${G2_PROSE}<script type="application/ld+json">{"@type":"Product","name":"x"}</script></body>`
  );
  assert.equal(article.run, true, 'og:type=article overrides Product');
  assert.equal(article.gate, 'none');

  const news = decideHtml(
    `<!DOCTYPE html><body>${G2_PROSE}<script type="application/ld+json">{"@type":"NewsArticle"}</script></body>`
  );
  assert.equal(news.run, true, 'NewsArticle runs');

  const job = decideHtml(
    `<!DOCTYPE html><body>${G2_PROSE}<script type="application/ld+json">{"@type":"JobPosting","title":"Engineer"}</script></body>`
  );
  assert.equal(job.run, true, 'JobPosting runs (keep salaries)');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test`
Expected: FAIL — the commerce cases come back `gate: 'none'`/`gate1-*` (Gate 2 doesn't exist yet, so commerce pages fall through to Gate 1's prose check and run). The precision-guard test may already pass (those should run anyway), but the suppress test fails.

- [ ] **Step 3: Add the `gate2-commerce` reason**

In `lib/gates.js`, add to the `REASONS` object:

```js
    'gate2-commerce': 'Looks like a shopping, listing, or booking page',
```

- [ ] **Step 4: Add Gate 2 detection helpers**

In `lib/gates.js`, add this block above `evaluatePage` (after the Gate 1 heuristic helpers, before `function evaluatePage`):

```js
  // --- Gate 2: page-type / commerce-archetype detection ---
  // Document-like pages whose archetype makes their numbers transactional or
  // comparative (shopping, listings, travel, menus). Detected from structured
  // data the page already ships for SEO, plus a small hostname net for
  // real-estate SPAs that don't. Per-site override recovers any miss.

  const COMMERCE_TYPES = new Set([
    'Product', 'ProductGroup', 'IndividualProduct', 'Offer', 'AggregateOffer',
    'Hotel', 'LodgingBusiness', 'Resort', 'Motel', 'BedAndBreakfast',
    'Flight', 'FlightReservation', 'LodgingReservation', 'TripReservation',
    'Restaurant', 'FoodEstablishment', 'CafeOrCoffeeShop', 'Menu', 'MenuItem',
    'RealEstateListing', 'Residence', 'Apartment', 'ApartmentComplex',
    'SingleFamilyResidence', 'House', 'Vehicle', 'Car',
  ]);

  // An explicit "this is an article" declaration overrides commerce signals
  // (a news review that quotes a price still runs).
  const ARTICLE_TYPES = new Set([
    'Article', 'NewsArticle', 'BlogPosting', 'Report', 'ScholarlyArticle',
    'TechArticle', 'OpinionNewsArticle', 'ReviewNewsArticle',
  ]);

  // Real-estate SPAs whose listings often ship no usable markup. Small,
  // override-recoverable net; domain-suffix match.
  const COMMERCE_HOSTS = [
    'zillow.com', 'apartments.com', 'apartmentlist.com', 'redfin.com',
    'trulia.com', 'realtor.com', 'hotpads.com',
  ];

  function matchCommerceHost(host) {
    return COMMERCE_HOSTS.some((d) => host === d || host.endsWith('.' + d));
  }

  // Strip a schema.org URL/prefix to the bare type name (e.g.
  // "https://schema.org/Product" -> "Product").
  function bareType(t) {
    return String(t)
      .replace(/^https?:\/\/schema\.org\//i, '')
      .replace(/\/$/, '')
      .split('/')
      .pop();
  }

  // All top-level @type names across the page's JSON-LD blocks. Handles a bare
  // object, an array of objects, or an @graph; @type may be string or array.
  function jsonLdTypes(doc) {
    const out = [];
    for (const el of doc.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try { data = JSON.parse(el.textContent); } catch (e) { continue; }
      const nodes = Array.isArray(data)
        ? data
        : data && Array.isArray(data['@graph'])
        ? data['@graph']
        : data
        ? [data]
        : [];
      for (const node of nodes) {
        const t = node && node['@type'];
        if (typeof t === 'string') out.push(bareType(t));
        else if (Array.isArray(t)) for (const x of t) out.push(bareType(x));
      }
    }
    return out;
  }

  function ogType(doc) {
    const m = doc.querySelector('meta[property="og:type"]');
    return m ? (m.getAttribute('content') || '').trim().toLowerCase() : '';
  }

  function hasCommerceMicrodata(doc) {
    for (const el of doc.querySelectorAll('[itemscope][itemtype]')) {
      if (COMMERCE_TYPES.has(bareType(el.getAttribute('itemtype')))) return true;
    }
    return false;
  }

  // Page-level: is this a commerce/transactional archetype?
  function isCommercePage(doc) {
    const host = (doc.location && doc.location.hostname) || '';
    const og = ogType(doc);
    const ldTypes = jsonLdTypes(doc);

    // Article guard wins — an explicit informational page never suppresses here.
    if (og === 'article' || ldTypes.some((t) => ARTICLE_TYPES.has(t))) return false;

    if (matchCommerceHost(host)) return true;
    if (og.indexOf('product') === 0) return true;
    if (ldTypes.some((t) => COMMERCE_TYPES.has(t))) return true;
    if (hasCommerceMicrodata(doc)) return true;
    return false;
  }
```

- [ ] **Step 5: Wire Gate 2 into the funnel**

In `lib/gates.js` `evaluatePage`, insert the Gate 2 check immediately after the hostname-list check and before `const region = dominantRegion(doc);`:

```js
    const listedGate = matchHostList(host);
    if (listedGate) return suppress(listedGate);

    // Gate 2: commerce/transactional page archetype (before the Gate 1
    // heuristics, so prose-rich commerce is caught and attributed correctly).
    if (isCommercePage(doc)) return suppress('gate2-commerce');

    const region = dominantRegion(doc);
```

- [ ] **Step 6: Run to verify they pass**

Run: `npm test`
Expected: green. The two new Gate 2 tests pass; all existing Gate 1 / detector / status tests still pass (existing fixtures have no commerce markup, so `isCommercePage` returns false and they behave exactly as before). Report the pass count.

- [ ] **Step 7: Commit**

```bash
git add lib/gates.js test/gates.test.js
git commit -m "$(cat <<'EOF'
Gate 2: commerce page-type detection (structured data + hostname net)

isCommercePage() checks og:type / JSON-LD @type / microdata for commerce
archetypes, plus a real-estate-SPA hostname net, with an article guard so
price-quoting news still runs. Slotted before the Gate 1 heuristics.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Tier 3 corpus fixtures

Extend the regression corpus: a prose-rich product page (Gate 1 would run; Gate 2 suppresses), a price-quoting article (must run — the precision guard), and promote the seeded real-estate case to a real Gate 2 gating test.

**Files:**
- Create: `test/fixtures/pages/product-jsonld.html`
- Create: `test/fixtures/pages/article-quotes-price.html`
- Modify: `test/fixtures/page-labels.json`

- [ ] **Step 1: Create the product fixture**

`test/fixtures/pages/product-jsonld.html`:

```html
<!DOCTYPE html>
<!-- signal: retail product page; rich prose description + Product JSON-LD. Gate 1 would RUN; Gate 2 suppresses. -->
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>VITTSKÄR 2-seat section — Store</title>
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Product","name":"VITTSKÄR 2-seat section","offers":{"@type":"Offer","price":"340.00","priceCurrency":"USD"},"aggregateRating":{"@type":"AggregateRating","ratingValue":"4.8","reviewCount":"2"}}
  </script>
</head>
<body>
  <main>
    <article>
      <h1>VITTSKÄR 2-seat section for modular sofa</h1>
      <p>
        Build the modular sofa of your dreams with the VITTSKÄR series. This
        2-seat section pairs deep, supportive cushions with a hard-wearing cover
        that stands up to everyday family life, and it connects seamlessly to the
        other sections so you can reshape your seating whenever the mood strikes.
      </p>
      <p class="price">$340.00</p>
      <p>Available for delivery with $35.00 order. In stock at Canton, MI.</p>
    </article>
  </main>
</body>
</html>
```

- [ ] **Step 2: Create the price-quoting article fixture**

`test/fixtures/pages/article-quotes-price.html`:

```html
<!DOCTYPE html>
<!-- signal: news article that QUOTES a product price; og:type=article must keep it running (Gate 2 precision guard). -->
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>The case against the $3,500 headset</title>
  <meta property="og:type" content="article" />
</head>
<body>
  <main>
    <article>
      <h1>The case against the $3,500 headset</h1>
      <p>
        When the company unveiled its $3,500 mixed-reality headset, analysts were
        split on whether a device costing as much as a high-end laptop could ever
        reach a mainstream audience, or whether it would stay a developer's
        curiosity for years.
      </p>
      <p>
        Early reviews praised the display while questioning the price, which sits
        well above what most consumers expect for the category.
      </p>
    </article>
  </main>
</body>
</html>
```

- [ ] **Step 3: Update labels — add the two fixtures, promote real-estate**

In `test/fixtures/page-labels.json`:

(a) Change the existing `real-estate-listing.html` entry from soft to a hard Gate 2 case by adding a commerce-host `url` and `tier: "hard"`:

```json
  {
    "file": "real-estate-listing.html",
    "tier": "hard",
    "url": "https://www.zillow.com/homedetails/123-maple-st",
    "page": { "expected": "suppress", "gate": "gate2-commerce" }
  },
```

(b) Add these two entries to the array (mind the trailing comma on the prior last entry):

```json
  {
    "file": "product-jsonld.html",
    "tier": "hard",
    "page": { "expected": "suppress", "gate": "gate2-commerce" }
  },
  {
    "file": "article-quotes-price.html",
    "tier": "hard",
    "page": { "expected": "run", "gate": "none" },
    "numbers": [
      { "text": "$3,500", "expected": "underline" }
    ]
  }
```

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: green. `product-jsonld` → `gate2-commerce` (Product JSON-LD beats the prose-run); `real-estate-listing` → `gate2-commerce` (hostname net, claimed by Gate 2 before Gate 1's prose check); `article-quotes-price` → runs and underlines `$3,500`. Report the pass count.

> Sanity check: confirm `article-quotes-price` actually underlines `$3,500` (currency + comma form). If the detector emits a different exact string, copy that literal into the label rather than forcing it.

- [ ] **Step 5: Run the decision eval**

Run: `npm run eval:decisions`
Expected: prints without throwing. (`job-listing` still runs; it has no commerce markup and `JobPosting` isn't a commerce type even if added.)

- [ ] **Step 6: Commit**

```bash
git add test/fixtures
git commit -m "$(cat <<'EOF'
Tier 3: Gate 2 fixtures (product JSON-LD, price-quoting article); promote
the seeded real-estate case to a hard gate2-commerce test

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Docs

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Extend the Gate 1 pointer to cover Gate 2**

In `CLAUDE.md`, under "Where to make changes", find the bullet that begins **"Whether Ballpark runs on a page at all (Gate 1):"** and append this sentence to it:

```markdown
 **Gate 2** (also in `lib/gates.js`, `isCommercePage`) suppresses commerce/transactional page archetypes (retail, real-estate, travel, menus) via structured data (JSON-LD `@type`, microdata, `og:type`) plus a small real-estate-SPA hostname net, with an article guard so price-quoting news still runs; it sits in `evaluatePage` between Gate 1's hostname list and Gate 1's heuristics. Gate 3 (per-number triage) is still unbuilt.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "$(cat <<'EOF'
Docs: note Gate 2 (commerce page-type detection) in CLAUDE.md

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Done-when

- `npm test` green: Gate 2 unit tests (structured data, og:type, microdata, @graph, hostname net) + precision guards (article / job-posting run) pass; `product-jsonld` + `real-estate-listing` assert `gate2-commerce`; `article-quotes-price` runs and underlines `$3,500`; all Gate 1 / detector / status tests unchanged.
- `npm run eval:decisions` runs clean.
- No new files, no manifest/permission changes, version stays **1.1.0** (combined Gate 1 + Gate 2 submission).

## Out of scope (later)

- Gate 3 (per-number triage) + graceful-failure message → next spec.
- Social/maps/sports archetypes (mostly Gate 1's job already) and DOM-pattern (cart/price-regex) detection.
