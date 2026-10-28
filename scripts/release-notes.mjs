#!/usr/bin/env node
// Génère les release notes (markdown, stdout) : issues GitHub fermées comme terminées depuis la
// dernière release publiée (GH154 — remplace TICKETS.md / tickets_archive.md, abandonnés).
// Usage : node scripts/release-notes.mjs <tag>
// Env   : GH_TOKEN (lecture des issues et releases, fourni par le workflow), GITHUB_REPOSITORY
//         (owner/repo ; à défaut, repo courant selon `gh`).
// Requiert la CLI `gh` (présente sur les runners GitHub).
import { execFileSync } from "node:child_process";

const tag = process.argv[2];
if (!tag) {
  console.error("Usage: release-notes.mjs <tag>");
  process.exit(1);
}

const gh = (...args) => execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] });
const repo = process.env.GITHUB_REPOSITORY || gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner").trim();

// Dernière release publiée autre que celle du tag en cours (relance du workflow : elle existe déjà).
function previousRelease() {
  const releases = JSON.parse(gh("release", "list", "--repo", repo, "--limit", "100", "--json", "tagName,publishedAt,isDraft,isPrerelease"));
  return releases
    .filter((r) => !r.isDraft && !r.isPrerelease && r.tagName !== tag && r.publishedAt)
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))[0];
}

// Fermées comme terminées : les doublons et « not planned » sont exclus.
function closedIssuesSince(since) {
  const q = [`repo:${repo}`, "is:issue", "is:closed", "reason:completed", since && `closed:>${since}`].filter(Boolean).join(" ");
  const out = gh("api", "-X", "GET", "search/issues", "--paginate", "-f", `q=${q}`, "-f", "per_page=100",
    "--jq", ".items[] | {number, title, labels: [.labels[].name]}");
  return out.split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
}

const prev = previousRelease();
const issues = closedIssuesSince(prev?.publishedAt).sort((a, b) => b.number - a.number);

const sections = [
  ["Nouveautés", (i) => i.labels.includes("type:feature")],
  ["Corrections", (i) => i.labels.includes("type:bug")],
  ["Autres", () => true],
];
const out = [];
const placed = new Set();
for (const [heading, match] of sections) {
  const items = issues.filter((i) => !placed.has(i.number) && match(i));
  if (!items.length) continue;
  items.forEach((i) => placed.add(i.number));
  out.push(`## ${heading}`, "", ...items.map((i) => `- #${i.number} — ${i.title}`), "");
}
if (!out.length) out.push("Aucune issue fermée depuis la version précédente.", "");
if (prev) out.push(`**Changelog complet** : https://github.com/${repo}/compare/${prev.tagName}...${tag}`);
console.log(out.join("\n").trimEnd());
