import { goUrl, searchFallback } from "./redirect.js";

chrome.omnibox.setDefaultSuggestion({ description: "Open GDG Japan go/<slug>" });
chrome.omnibox.onInputEntered.addListener((text) => {
  const destination = goUrl(text);
  if (destination) void chrome.tabs.update({ url: destination });
});

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0 || details.tabId < 0) return;
  const destination = searchFallback(details.url);
  if (destination) void chrome.tabs.update(details.tabId, { url: destination });
});
