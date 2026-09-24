#!/usr/bin/env node
// Génère les release notes (markdown, stdout) : tickets passés à "traité" entre deux tags.
// Usage : node scripts/release-notes.mjs <tag> [<tag-précédent>]
// Env   : GITHUB_REPOSITORY (owner/repo) pour construire les liens.
import { execFileSync } from "node:child_process";

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: release-notes.mjs <tag> [<previous-tag>]");
  process.exit(1);
}
const repo = process.env.GITHUB_REPOSITORY;

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

function previousTag() {
  try {
    return git("describe", "--tags", "--abbrev=0", `${tag}^`).trim();
  } catch {
    return "";
  }
}

function show(ref, path) {
  try {
    return git("show", `${ref}:${path}`);
  } catch {
    return "";
  }
}

const HEADING = /^### (T\d+[\w-]*) — (.+?)\s*$/;

// Tickets traités : tous ceux de tickets_archive.md + ceux de la section "## Done" de TICKETS.md.
function doneTickets(ref) {
  const found = new Map();
  const collect = (text) => {
    for (const line of text.split(/\r?\n/)) {
      const m = HEADING.exec(line);
      if (m) found.set(m[1], m[2]);
    }
  };
  collect(show(ref, "tickets_archive.md"));
  const tickets = show(ref, "TICKETS.md");
  const doneAt = tickets.search(/^## Done\s*$/m);
  if (doneAt >= 0) collect(tickets.slice(doneAt));
  return found;
}

const prev = process.argv[3] ?? previousTag();
const before = prev ? doneTickets(prev) : new Map();
const after = doneTickets(tag);

const added = [...after].filter(([id]) => !before.has(id));
added.sort((a, b) => parseInt(b[0].slice(1), 10) - parseInt(a[0].slice(1), 10));

const specExists = (id) => show(tag, `specs/${id}.md`) !== "";
const blob = (path) => `https://github.com/${repo}/blob/${tag}/${path}`;

const lines = added.map(([id, title]) => {
  const link = repo && specExists(id) ? `[${id}](${blob(`specs/${id}.md`)})` : id;
  return `- ${link} — ${title}`;
});

const out = [];
out.push(lines.length ? "## Tickets traités" : "## Tickets traités\n\nAucun ticket traité depuis la version précédente.");
if (lines.length) out.push("", ...lines);
if (prev && repo) out.push("", `**Changelog complet** : https://github.com/${repo}/compare/${prev}...${tag}`);
console.log(out.join("\n"));
