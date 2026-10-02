// Motion: type the hero title, then let each section drift in as it scrolls into view.
// The "motion" class is set in the page head, and left off for reduced motion.
(function motion() {
  if (!document.documentElement.classList.contains("motion")) return;

  const reveal = (elements, kind, step = 0) =>
    [...elements].forEach((el, i) => {
      el.classList.add("reveal", kind);
      if (step) el.style.setProperty("--reveal-delay", `${i * step}s`);
    });

  // Hero: shown by the typewriter, not by scrolling.
  const hero = document.querySelector(".hero");
  const heroParts = [...hero.querySelectorAll(".eyebrow, .lede, .cta, .cta-note")];
  reveal(heroParts, "up", 0.14);
  reveal([hero.querySelector(".hero-shot")], "settle");
  hero.querySelector(".hero-shot").style.setProperty("--reveal-delay", `${heroParts.length * 0.14 + 0.1}s`);

  // Everything else: shown as it scrolls into view.
  const onScroll = [];
  const track = (elements, kind, step) => {
    reveal(elements, kind, step);
    onScroll.push(...elements);
  };
  document.querySelectorAll(".feature-row").forEach((row) => {
    const copy = row.querySelector(".feature-copy");
    track([copy], row.classList.contains("reverse") ? "from-right" : "from-left");
    track([row.querySelector(".window")], "settle");
  });
  track(document.querySelectorAll(".mode"), "up", 0.1);
  document.querySelectorAll(".themes, .grid-section, .download").forEach((section) => {
    track(section.querySelectorAll(":scope > .eyebrow, :scope > h2, :scope > .section-lede"), "up", 0.1);
  });
  track(document.querySelectorAll(".theme-tabs, .platforms, .download > .other-platforms, .unsigned-note"), "up");
  track(document.querySelectorAll(".theme-shot"), "settle");
  track(document.querySelectorAll(".card"), "up", 0.08);

  const observer = new IntersectionObserver(
    (entries) =>
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }),
    { rootMargin: "0px 0px -12% 0px" },
  );
  onScroll.forEach((el) => observer.observe(el));

  // Typewriter. Every letter is laid out from the start (hidden), so the title never reflows;
  // screen readers get the whole sentence at once.
  const title = document.getElementById("hero-title");
  const text = title.textContent;
  const label = document.createElement("span");
  label.className = "sr-only";
  label.textContent = text;
  const typed = document.createElement("span");
  typed.setAttribute("aria-hidden", "true");
  const chars = [...text].map((c) => {
    const span = document.createElement("span");
    span.className = "type-char";
    span.textContent = c;
    typed.append(span);
    return span;
  });
  title.replaceChildren(label, typed);

  const showHero = () => heroParts.concat(hero.querySelector(".hero-shot")).forEach((el) => el.classList.add("visible"));
  // The first half is already on the page, caret waiting after it, so the animation reads as finishing the sentence.
  const start = text.indexOf(" ", Math.floor(text.length / 2) - 1) + 1;
  chars.slice(0, start).forEach((c) => c.classList.add("typed"));
  // The caret sits on the last letter, never on a space, which can fall at the end of a line.
  let caretOn = chars[start - 2];
  caretOn.classList.add("caret");
  // The rest of the hero arrives while the last words are being typed.
  const heroAt = start + Math.floor((chars.length - start) * 0.4);
  let i = start;
  const typeNext = () => {
    typed.classList.add("typing");
    chars[i].classList.add("typed");
    if (chars[i].textContent !== " ") {
      caretOn.classList.remove("caret");
      caretOn = chars[i];
      caretOn.classList.add("caret");
    }
    if (i === heroAt) showHero();
    i += 1;
    if (i === chars.length) {
      typed.classList.remove("typing");
      // Blink a while after the full stop, then fade away.
      setTimeout(() => typed.classList.add("caret-gone"), 4000);
      return;
    }
    // A human rhythm: a little uneven, with a breath after spaces and punctuation.
    const prev = chars[i - 1].textContent;
    const pause = prev === " " ? 70 : /[.,]/.test(prev) ? 220 : 0;
    setTimeout(typeNext, 55 + Math.random() * 50 + pause);
  };
  setTimeout(typeNext, 900);
})();

// Theme switcher: swaps the large screenshot.
(function themes() {
  const image = document.getElementById("theme-image");
  const tabs = document.querySelectorAll(".theme-tabs button");
  // Warm the cache so switching is instant.
  tabs.forEach((tab) => {
    new Image().src = `assets/screens/${tab.dataset.shot}.webp`;
  });
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.setAttribute("aria-selected", String(t === tab)));
      image.classList.add("fading");
      const next = new Image();
      next.onload = () => {
        image.src = next.src;
        image.alt = `Mido with the ${tab.textContent} theme`;
        image.classList.remove("fading");
      };
      next.src = `assets/screens/${tab.dataset.shot}.webp`;
    });
  });
})();

// Downloads: point each button straight at its installer in the latest release.
(async function downloads() {
  const R = window.MidoReleases;
  const heroNote = document.getElementById("hero-note");
  const info = document.getElementById("release-info");

  let release;
  try {
    release = (await R.load())[0];
  } catch {
    // Not deployed through the Pages workflow (e.g. a local preview).
  }
  if (!release) {
    info.innerHTML = `Installers will appear on the <a href="https://github.com/${R.REPO}/releases">releases page</a> with the first release.`;
    return;
  }

  const version = R.version(release);
  const changelog = `changelog.html#v${version}`;
  info.textContent = `Version ${version} · released ${R.date(release)}`;
  heroNote.textContent = `Version ${version} · Free · Your files stay plain Markdown on your disk`;

  const badge = document.getElementById("release-version");
  badge.textContent = `v${version}`;
  badge.hidden = false;

  const whatsNew = document.getElementById("whats-new");
  whatsNew.textContent = `What's new in ${version} →`;
  whatsNew.href = changelog;
  whatsNew.hidden = false;

  const assets = { "mac-arm": R.dmg(release, "aarch64"), "mac-intel": R.dmg(release, "x64") };
  document.querySelectorAll("[data-asset]").forEach((link) => {
    const asset = assets[link.dataset.asset];
    if (!asset) {
      link.href = release.html_url;
      return;
    }
    link.href = asset.browser_download_url;
    link.title = asset.name;
    link.querySelector(".asset-meta").textContent = `.dmg · ${R.size(asset.size)}`;
  });
})();
