(function installWebmailAppearance(css, origin) {
  if (location.origin !== origin || window.vercunoAndroid || !document.head) return;

  const style = document.createElement("style");
  style.id = "vercuno-android-appearance";
  style.textContent = css;
  document.head.append(style);

  const rowSelector = "#main-content [role='list'] .group:has(> input[type=checkbox]):has(> a)";
  const menuSelector = "button[data-mobile-menu][aria-expanded=true]";
  let frame = 0;

  function updateAppearance() {
    frame = 0;
    const search = document.querySelector("input[data-mail-search-input]");
    const label = search?.getAttribute("aria-label");
    if (label && search.placeholder !== label && matchMedia("(max-width: 767px)").matches) {
      search.placeholder = label;
    }
    for (const row of document.querySelectorAll(rowSelector)) {
      const party = row.querySelector(":scope > a > span:first-child > span:first-child");
      if (!party) continue;
      const name = Array.from(party.childNodes)
        .filter((item) => item.nodeType === Node.TEXT_NODE)
        .map((item) => item.textContent)
        .join("")
        .trim();
      if (!name) continue;
      const words = name.split(/[\s@.]+/).filter(Boolean);
      const initials = words.slice(0, 2).map((word) => Array.from(word)[0]).join("").toLocaleUpperCase();
      const tone = Array.from(name).reduce((sum, char) => sum + char.codePointAt(0), 0) % 5;
      row.dataset.androidInitials = initials;
      row.dataset.androidTone = String(tone);
      row.toggleAttribute("data-android-unread", Boolean(party.querySelector(":scope > .sr-only")));
    }
  }

  function scheduleAppearance() {
    if (!frame) frame = requestAnimationFrame(updateAppearance);
  }

  function back() {
    const dialog = document.querySelector("dialog[open], [role=dialog][data-state=open]");
    if (dialog) {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
      return true;
    }
    const closeComposer = document.querySelector("[data-compose-surface] button[class*='max-md:-m-2'][aria-label]");
    if (closeComposer?.getClientRects().length) {
      closeComposer.click();
      return true;
    }
    const openMenu = document.querySelector(menuSelector)
      ?? document.querySelector(".safe-area header button[aria-expanded=true]:not([aria-controls])");
    if (openMenu?.getClientRects().length) {
      openMenu.click();
      return true;
    }
    return false;
  }

  // The webmail creates a short-lived blob for its “download original” action.
  // Android saves that file from the same authenticated message endpoint.
  document.addEventListener("click", (event) => {
    const link = event.target instanceof Element ? event.target.closest("a[download][href^=blob]") : null;
    if (!link || !link.href.startsWith("blob:" + origin + "/")) return;
    const match = /^original-([a-z0-9_-]+)\.eml$/i.exec(link.download);
    if (match) link.href = "/api/messages/" + encodeURIComponent(match[1]) + "/original";
  }, true);

  new MutationObserver(scheduleAppearance).observe(document.documentElement, {
    childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["placeholder"],
  });
  scheduleAppearance();
  window.vercunoAndroid = { back };
})
