# CONTEXT.md — Historique des décisions de conception

Ce fichier capture les réflexions et décisions structurantes prises lors de la
conception du système de spécification. À lire pour comprendre le "pourquoi"
derrière les conventions du projet.

---

## Genèse du système

### Problème à résoudre
Mettre en place un système de gestion des exigences type ALM (Polarion, DOORS)
**natif IA** — pensé dès le départ pour travailler efficacement avec Claude Code,
plutôt que d'adapter un outil legacy.

### Domaine cible
Produits électroménager sur batterie (ex: aspirateur sans fil).
Système multi-domaines avec interfaces fortes : Firmware ↔ Électronique ↔
Mécanique ↔ Batterie ↔ Produit.

Niveau de formalisme : **réel mais pas certifié** (pas DO-178, pas IEC 62304 medtech).
Les normes applicables sont IEC 60335 (sécurité électroménager) et IEC 62133 (batteries Li-ion).

---

## Décisions architecturales clés

### D1 — Fichiers versionnés Git, pas de base de données

**Décision** : Le stockage est en fichiers texte (`.md`, `.yaml`, `.drawio`).
Pas de SQLite, pas de base de données applicative.

**Pourquoi** :
- Claude Code lit directement le contexte sans couche d'extraction
- Tout est diffable et versionnable nativement
- Pas de dépendance à un service externe
- La DB est un anti-pattern pour la collaboration IA

**Conséquence** : L'interface web est un **viewer/éditeur** par-dessus les fichiers,
pas la source de vérité. Les fichiers restent la source de vérité.

---

### D2 — Markdown + frontmatter YAML pour les exigences

**Décision** : Chaque exigence est un fichier `.md` avec un bloc frontmatter YAML.

**Pourquoi** :
- Lisible par un humain ET par Claude sans parsing complexe
- Le frontmatter porte les métadonnées structurées (ID, statut, liens)
- Le corps Markdown porte le sens (énoncé, justification, critères)
- Génération de matrices de traçabilité scriptable en Python simple

**Alternative rejetée** : Tout en YAML pur → trop peu lisible pour la rédaction humaine.

---

### D3 — Syntaxe EARS pour les énoncés d'exigences

**Décision** : Tous les énoncés d'exigences utilisent la syntaxe EARS
(Easy Approach to Requirements Syntax).

**Pourquoi** :
- Réduit l'ambiguïté naturelle du langage (problème n°1 des specs)
- Claude est très efficace pour convertir du langage naturel flou en EARS propre
- Facilite la détection automatique des exigences mal formées
- Compatible avec les outils ALM si export futur vers Polarion/DOORS

**Patterns retenus** : Ubiquitaire, Événementiel, Conditionnel, Optionnel, Réponse indésirable.

---

### D4 — `.drawio` comme source de vérité des diagrammes

**Décision** : Les diagrammes sont en `.drawio` (XML), référencés depuis les `.md`
avec un pointeur vers le node ID précis (`diagrams/foo.drawio#node-PWR-001`).

**Pourquoi** :
- Format XML lisible et modifiable par Claude Code
- draw.io est gratuit, open source, largement utilisé en bureau d'études
- Le pointeur vers le node ID crée une traçabilité fine diagramme ↔ exigence
- Claude peut générer et modifier du XML draw.io programmatiquement

**Diagrammes prioritaires identifiés pour électroménager batterie** :
1. Vue système globale (contexte et interfaces)
2. Architecture de puissance (BMS, driver moteur, alimentation)
3. Machine d'états firmware (modes opérationnels)
4. Architecture BMS
5. Arbre cinématique mécanique

---

### D5 — Application desktop Electron

**Décision** : Construire une application desktop Electron (pas une webapp) pour
la visualisation, navigatio, l'édition des exigences, des tests, des campagnes de test, et l'execution des campagnes de test.

**Pourquoi** :
- Accès direct au système de fichiers sans serveur intermédiaire
- Rend le système accessible à toute l'équipe (pas seulement les devs avec Claude Code)
- Ouvre les repos git locaux directement — pas de clonage serveur
- Reste découplée du stockage → pas de lock-in

**Stack retenue** :
- **Electron** + **electron-vite** (bundler)
- **React** + **TanStack Router** (routing côté renderer)
- **TanStack Query** (data fetching / cache)
- **Tailwind CSS** (design system, tokens CSS custom, dark mode via ThemeContext)
- **Schéma de données** : `.polenta/schema.yaml` géré via un éditeur visuel intégré (`SchemaEditorPage`)

---

### D6 — Scripts Python pour l'outillage

**Décision** : L'outillage (lint, matrice, export) est en Python simple, ~200 lignes total.

**Scripts prévus** :
- `check.py` — vérifie les frontmatters (champs manquants, IDs orphelins, EARS valide)
- `matrix.py` — génère `traceability/matrix.yaml` depuis tous les frontmatters
- `export.py` — génère un PDF ou HTML de review pour jalons projet

**Pourquoi Python** : Lisible, maintenable par Claude Code, pas de dépendance lourde.

---

## Tensions et compromis identifiés

| Tension | Choix fait | Raison |
|---|---|---|
| Fichiers vs DB | Fichiers | Meilleur pour IA, diffable |
| Formalisme vs agilité | Formalisme modéré | Produit réel avec normes IEC |
| Remplacer Polarion vs coexister | Remplacer | Système greenfield, pas de legacy |
| Claude Code vs interface web | Les deux | CC pour ingénieurs, web pour équipe |

---

## Ce qui reste à construire

- [ ] Templates d'exigences par domaine (SYS, SW, HW, MECA, BAT, PROD)
- [ ] Script `check.py`
- [ ] Script `matrix.py`
- [ ] Premiers diagrammes `.drawio` de référence
- [ ] Interface web (visualisation + navigation)
- [ ] Exemples d'exigences pour aspirateur sur batterie (amorçage)

---

## Références utiles

- **EARS** : Mavin et al., "Easy Approach to Requirements Syntax" (2009)
- **IEC 60335-1** : Sécurité des appareils électrodomestiques
- **IEC 60335-2-2** : Exigences particulières pour les aspirateurs
- **IEC 62133-2** : Sécurité des accumulateurs Li-ion portables
- **draw.io XML format** : https://github.com/jgraph/drawio/wiki
