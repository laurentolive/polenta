#!/usr/bin/env bash
# GH52 — publication des mises à jour servies par le serveur du client : dossier etc/updates/ du Caddy du kit,
# servi par la route /polenta-updates/ de chaque bloc d'instance (caddy_render_site). Sourcé après common.sh.
#
# Une publication = un dossier contenant latest.yml (électron-builder) et les installeurs qu'il référence.
# Ordre : les artefacts d'abord, latest.yml en dernier et de façon atomique : un poste ne voit jamais un
# latest.yml qui désigne un fichier absent. Rien n'écrase une version déjà publiée.

# Noms de fichiers acceptés : pas de chemin, pas de « .. », pas de fichier caché.
updates_name_ok() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9._\ -]*$ && "$1" != *..* ]]
}

# Fichiers référencés par latest.yml (clés url: et path:, à plat ou dans files:), un par ligne.
updates_files_of() {
  sed -n -E 's/^[[:space:]]*-?[[:space:]]*(url|path):[[:space:]]*(.+)$/\2/p' "$1" \
    | sed -e "s/^['\"]//" -e "s/['\"][[:space:]]*$//" | sort -u
}

updates_version_of() {
  sed -n -E 's/^version:[[:space:]]*(.+)$/\1/p' "$1" | head -n1 | sed -e "s/^['\"]//" -e "s/['\"][[:space:]]*$//"
}

# Contrôle d'une publication sans rien copier. Meurt au premier écart.
updates_check() {
  local src="$1" yml f
  yml="$src/latest.yml"
  [[ -f "$yml" ]] || die "$E_USAGE" "latest.yml absent de $src : rien n'a été publié."
  [[ -n "$(updates_version_of "$yml")" ]] || die "$E_USAGE" "version absente de $yml : rien n'a été publié."
  local files; files="$(updates_files_of "$yml")"
  [[ -n "$files" ]] || die "$E_USAGE" "aucun fichier référencé dans $yml : rien n'a été publié."
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    updates_name_ok "$f" || die "$E_USAGE" "nom refusé dans latest.yml : « $f » (rien n'a été publié)."
    [[ -f "$src/$f" ]] || die "$E_USAGE" "fichier référencé absent de $src : $f (rien n'a été publié)."
  done <<<"$files"
}

# Publication : refuse une version déjà présente, copie les artefacts (et leurs blockmap), puis latest.yml.
updates_publish() {
  local src="$1" dest="$POLENTA_CADDY/etc/updates" f version
  src="${src%/}"
  # GH61 : en external le kit ne crée ni dossier ni fichier Caddy ; la route est celle de l'exploitant.
  if caddy_external; then
    die "$E_USAGE" "updates publish refusé en CADDY_MODE=external : la route /polenta-updates/ est celle du Caddy de l'exploitant (voir RUNBOOK)."
  fi
  updates_check "$src"
  version="$(updates_version_of "$src/latest.yml")"
  mkdir -p "$dest"
  local files; files="$(updates_files_of "$src/latest.yml")"
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    [[ ! -e "$dest/$f" ]] || die "$E_USAGE" "déjà publié : $f. Publication refusée, rien n'a été écrit."
  done <<<"$files"
  # Artefacts : copie sous un nom caché puis renommage ; un échec ne laisse que des fichiers cachés.
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    if ! cp "$src/$f" "$dest/.$f.part" || ! mv -f "$dest/.$f.part" "$dest/$f"; then
      rm -f "$dest/.$f.part"
      die "copie de $f en échec : latest.yml inchangé, rien de nouveau n'est référencé."
    fi
    if [[ -f "$src/$f.blockmap" ]]; then
      cp "$src/$f.blockmap" "$dest/$f.blockmap"
    fi
  done <<<"$files"
  # latest.yml en dernier, par renommage (atomique sur le même système de fichiers).
  cp "$src/latest.yml" "$dest/.latest.yml.part" && mv -f "$dest/.latest.yml.part" "$dest/latest.yml"
  # host_log n'existe que dans polenta-host.sh (les tests sourcent cette bibliothèque seule).
  if declare -F host_log >/dev/null; then host_log "updates publish $version" OK; fi
  ok "version $version publiée dans $dest (route /polenta-updates/)"
}
