// Contenu métier du workspace de démonstration : exigences, tests, liens, paramètres, runs,
// campagnes, reviews, requêtes et dashboards — chacun daté par une « phase » du projet, pour
// produire un historique git réaliste (auteurs, dates, baselines RE1/RE2, pins qui bougent).

// ─── Repos & personnes ───────────────────────────────────────────────────────

export const GH_OWNER = 'laurentolive'

export const REPOS = {
  bus: { dir: 'if-bus-interne', remote: 'demo-ll800-if-bus-interne' },
  wifi: { dir: 'comp-module-wifi', remote: 'demo-ll800-comp-module-wifi' },
  pompe: { dir: 'comp-pompe-vidange', remote: 'demo-ll800-comp-pompe-vidange' },
  moteur: { dir: 'comp-moteur', remote: 'demo-ll800-comp-moteur' },
  produit: { dir: 'll800-produit', remote: 'demo-ll800-produit' },
}
/** Ordre de traitement : feuilles d'abord (le produit épingle le SHA du module Wi-Fi). */
export const REPO_ORDER = ['bus', 'wifi', 'pompe', 'moteur', 'produit']

export const repoUrl = key => `https://github.com/${GH_OWNER}/${REPOS[key].remote}.git`

export const P = {
  claire: { name: 'Claire Martin', email: 'claire.martin@demo-ll800.example', role: 'Cheffe de produit' },
  hugo: { name: 'Hugo Bernard', email: 'hugo.bernard@demo-ll800.example', role: 'Architecte système' },
  ines: { name: 'Inès Leroy', email: 'ines.leroy@demo-ll800.example', role: 'Responsable logiciel' },
  marc: { name: 'Marc Dubois', email: 'marc.dubois@demo-ll800.example', role: 'Responsable validation' },
  sophie: { name: 'Sophie Laurent', email: 'sophie.laurent@demo-ll800.example', role: 'Ingénieure hydraulique / méca' },
  yann: { name: 'Yann Petit', email: 'yann.petit@demo-ll800.example', role: 'Ingénieur électronique de puissance' },
}

export const PHASES = [
  { key: 'P1', date: '2026-03-03T09:00:00+01:00', msg: 'Initialisation du référentiel (schéma, paramètres, diagrammes)', by: { default: P.hugo } },
  { key: 'P2', date: '2026-03-17T10:30:00+01:00', msg: 'Rédaction des exigences', by: { default: P.hugo, produit: P.claire, pompe: P.sophie, moteur: P.yann, wifi: P.ines } },
  { key: 'P3', date: '2026-04-08T14:00:00+02:00', msg: 'Rédaction des tests et liens de traçabilité', by: { default: P.marc } },
  { key: 'P4', date: '2026-04-24T16:00:00+02:00', msg: "Revue d'étude RE1 — passage en revue / approbation", by: { default: P.hugo },
    tags: [{ tag: 'RE1', message: "Baseline RE1 — revue d'étude n°1", date: '2026-04-30T18:00:00+02:00' }],
    // Tags de version légers : un pin sur tag annoté n'est pas reconnu hors ligne (cf. GUIDE-EVALUATION §5).
    repoTags: { bus: [{ tag: 'v1.0', lightweight: true }] } },
  { key: 'P5', date: '2026-05-20T11:00:00+02:00', msg: 'Campagne EVT — exécution des essais', by: { default: P.marc },
    repoTags: { pompe: [{ tag: 'v2.0', lightweight: true }] } },
  { key: 'P6', date: '2026-06-15T09:30:00+02:00', msg: 'Évolutions post-EVT (essorage 1400 tr/min, protocole v1.1, obsolescences)', by: { default: P.hugo, produit: P.claire, moteur: P.yann, bus: P.ines },
    tags: [{ tag: 'RE2', message: "Baseline RE2 — revue d'étude n°2 (post-EVT)", date: '2026-06-30T18:00:00+02:00' }],
    repoTags: { bus: [{ tag: 'v1.1', lightweight: true }] } },
  { key: 'P7', date: '2026-07-08T10:00:00+02:00', msg: 'Campagnes DVT et KPI, revue des évolutions', by: { default: P.marc } },
  { key: 'P8', date: '2026-07-20T15:00:00+02:00', msg: 'Ajustements après revue DVT', by: { default: P.claire, moteur: P.yann } },
]

/** Branche de développement non fusionnée (démontre branches, merge, analyse d'impact live). */
export const DEV_BRANCH = {
  repo: 'produit',
  name: 'dev-essorage-1600',
  date: '2026-07-22T09:15:00+02:00',
  by: P.claire,
  msg: 'Étude : essorage 1600 tr/min et programme vapeur',
}

// ─── Paramètres (parameters/parameters.yaml) par repo et par phase ───────────

export const PARAMETERS = {
  produit: {
    P1: {
      capacite_kg: { value: '8', unit: 'kg', description: 'Charge nominale de linge sec (programme Coton)' },
      vitesse_essorage: { value: '1200', unit: 'tr/min', description: "Vitesse d'essorage maximale annoncée" },
      temperature_max_lavage: { value: '90', unit: '°C', description: 'Température maximale de lavage' },
      consommation_eau_eco: { value: '45', unit: 'L', description: 'Consommation d\'eau max. du programme Eco 40-60 à pleine charge' },
      niveau_sonore_essorage: { value: '74', unit: 'dB(A)', description: 'Puissance acoustique max. en essorage' },
      classe_energetique: { value: 'A', description: 'Classe énergétique visée (règlement UE 2019/2014)' },
      duree_programme_eco: { value: '225', unit: 'min', description: 'Durée max. du programme Eco 40-60' },
      pression_eau_min: { value: '0.05', unit: 'MPa', description: "Pression d'alimentation minimale" },
      pression_eau_max: { value: '1', unit: 'MPa', description: "Pression d'alimentation maximale" },
      tension_alimentation: { value: '230', unit: 'V', description: 'Tension secteur nominale' },
      puissance_veille_max: { value: '0.5', unit: 'W', description: 'Consommation max. en veille' },
    },
    P6: {
      vitesse_essorage: { value: '1400', unit: 'tr/min', description: "Vitesse d'essorage maximale annoncée" },
      puissance_veille_max: { value: '0.5', unit: 'W', description: 'Consommation max. en veille (hors Wi-Fi connecté)' },
    },
  },
  moteur: {
    P1: {
      vitesse_essorage_max: { value: '1200', unit: 'tr/min', description: 'Vitesse maximale tambour supportée par le moteur' },
      couple_nominal: { value: '1.2', unit: 'N·m', description: 'Couple nominal en lavage' },
      temp_max_bobinage: { value: '130', unit: '°C', description: 'Température max. du bobinage (classe B)' },
      courant_max: { value: '8', unit: 'A', description: 'Courant de phase maximal' },
      rendement_min: { value: '90', unit: '%', description: "Rendement minimal de l'onduleur à charge nominale" },
    },
    P6: {
      vitesse_essorage_max: { value: '1400', unit: 'tr/min', description: 'Vitesse maximale tambour supportée par le moteur' },
    },
  },
  pompe: {
    P1: {
      debit_nominal: { value: '22', unit: 'L/min', description: 'Débit à 1 m de hauteur de refoulement' },
      hauteur_refoulement: { value: '1', unit: 'm', description: 'Hauteur de refoulement nominale' },
      bruit_max: { value: '', unit: 'dB(A)', description: 'À définir avec le fournisseur — valeur vide volontaire (référence non résolue)' },
    },
  },
  wifi: {
    P1: {
      bande_wifi: { value: '2.4', unit: 'GHz', description: 'Bande radio' },
      delai_appairage: { value: '120', unit: 's', description: "Durée max. de la fenêtre d'appairage" },
    },
  },
  bus: {
    P1: {
      debit_bus: { value: '115200', unit: 'bauds', description: 'Débit du bus série' },
      delai_reponse_device: { value: '20', unit: 'ms', description: "Délai max. de réponse d'un périphérique" },
      periode_scrutation: { value: '100', unit: 'ms', description: 'Période de scrutation du contrôleur' },
    },
    P6: {
      delai_reponse_device: { value: '10', unit: 'ms', description: "Délai max. de réponse d'un périphérique (v1.1)" },
    },
  },
}

// ─── Éléments (exigences & tests) ────────────────────────────────────────────
// `at` : état par phase — chaque entrée est fusionnée sur la précédente (fields fusionnés
// champ à champ ; `needsRevalidation: false` retire le drapeau).

export const ELEMENTS = []
const req = (repo, id, ref, folder, title, at) => ELEMENTS.push({ repo, id, ref, folder, title, cat: 'requirement', at })
const tst = (repo, id, ref, folder, title, at) => ELEMENTS.push({ repo, id, ref, folder, title, cat: 'test', at })
const steps = (...rows) => rows.map(([action, expectedResult, notes = null], i) => ({ order: i + 1, action, expectedResult, notes }))

const drawioBlock = payload => '```drawio\n' + JSON.stringify(payload) + '\n```'
const imageBlock = payload => '```image\n' + JSON.stringify(payload) + '\n```'

// ── Produit : exigences produit (PRD) ──

const PRD = 'root::exigence-produit'
req('produit', 'PRD-0001', PRD, 'Performance', 'Capacité de charge', {
  P2: { status: 'draft', fields: {
    statement: 'THE lave-linge SHALL accepter une charge de linge sec de {capacite_kg} en programme Coton.',
    priority: 'high', source: 'Marketing', marches: 'EU, US', claim: true, kpi_cible: '8 kg', echeance: '2026-06-30',
    responsable: 'Claire Martin',
    rationale: 'Segment cœur de marché : les concurrents directs proposent **8 kg** sur le même encombrement (60 × 60 × 85 cm).',
    acceptanceCriteria: '- [ ] Charge normalisée EN 60456 de {capacite_kg} introduite sans forcer\n- [ ] Hublot fermé sans effort > 50 N',
  } },
  P4: { status: 'approved' },
})
req('produit', 'PRD-0002', PRD, 'Performance', "Vitesse d'essorage maximale", {
  P2: { status: 'draft', fields: {
    statement: "THE lave-linge SHALL essorer à une vitesse maximale de {vitesse_essorage} en programme Coton.",
    priority: 'high', source: 'Marketing', marches: 'EU', claim: true, kpi_cible: '1200 tr/min', responsable: 'Claire Martin',
    acceptanceCriteria: '- [ ] Vitesse mesurée au tachymètre ≥ {vitesse_essorage} − 2 %',
  } },
  P4: { status: 'approved' },
  P6: { needsRevalidation: true, fields: { kpi_cible: '1400 tr/min' } },
})
req('produit', 'PRD-0003', PRD, 'Performance', "Consommation d'eau du programme Eco 40-60", {
  P2: { status: 'draft', fields: {
    statement: 'WHEN le programme Eco 40-60 est exécuté à pleine charge\nTHE lave-linge SHALL consommer au plus {consommation_eau_eco} d\'eau.',
    priority: 'high', source: 'Réglementation', marches: 'EU', claim: false, kpi_cible: '≤ 45 L', responsable: 'Hugo Bernard',
    rationale: 'Règlement (UE) 2019/2023 — écoconception des lave-linge ménagers.',
    acceptanceCriteria: '- [ ] Mesure selon EN 60456, moyenne de 3 cycles ≤ {consommation_eau_eco}',
  } },
  P4: { status: 'approved' },
})
req('produit', 'PRD-0004', PRD, 'Performance', 'Niveau sonore en essorage', {
  P2: { status: 'draft', fields: {
    statement: 'WHILE le lave-linge essore à sa vitesse maximale\nTHE lave-linge SHALL émettre une puissance acoustique inférieure à {niveau_sonore_essorage}.',
    priority: 'medium', source: 'Réglementation', marches: 'EU', claim: true, kpi_cible: '≤ 74 dB(A)',
    acceptanceCriteria: '- [ ] Mesure en salle semi-anéchoïque selon IEC 60704-2-4',
  } },
  P4: { status: 'approved' },
})
req('produit', 'PRD-0005', PRD, 'Performance', 'Durée du programme Eco 40-60', {
  P2: { status: 'draft', fields: {
    statement: 'WHEN le programme Eco 40-60 est lancé à pleine charge\nTHE lave-linge SHALL terminer le cycle en moins de {duree_programme_eco}.',
    priority: 'medium', source: 'Réglementation', marches: 'EU', kpi_cible: '≤ 3 h 45',
    acceptanceCriteria: '- [ ] Durée mesurée ≤ {duree_programme_eco}',
  } },
  P4: { status: 'approved' },
})
req('produit', 'PRD-0006', PRD, 'Usage', 'Départ différé', {
  P2: { status: 'draft', fields: {
    statement: "WHERE l'option départ différé est sélectionnée\nTHE lave-linge SHALL démarrer le cycle après le délai choisi, réglable de 1 h à 24 h par pas de 1 h.",
    priority: 'medium', source: 'Retour terrain', marches: 'EU, US, CN, JP',
    acceptanceCriteria: '- [ ] Démarrage effectif à ± 1 min du délai programmé',
  } },
  P4: { status: 'review' },
  P8: { version: 2, fields: {
    statement: "WHERE l'option départ différé est sélectionnée\nTHE lave-linge SHALL démarrer le cycle après le délai choisi, réglable de 30 min à 24 h par pas de 30 min.",
  } },
})
req('produit', 'PRD-0007', PRD, 'Usage', 'Sécurité enfant', {
  P2: { status: 'draft', fields: {
    statement: "WHILE la sécurité enfant est activée\nTHE lave-linge SHALL ignorer tout appui sur les touches de la façade, à l'exception de l'appui long de 3 s sur la combinaison de déverrouillage.",
    priority: 'high', source: 'Normes', marches: 'EU, US, CN, JP',
    acceptanceCriteria: '- [ ] Appuis courts sur chaque touche sans effet\n- [ ] Déverrouillage après 3 s ± 0,5 s',
  } },
  P4: { status: 'approved' },
})
req('produit', 'PRD-0008', PRD, 'Réglementaire', 'Verrouillage du hublot', {
  P2: { status: 'draft', fields: {
    statement: "IF la température de l'eau dépasse 50 °C ou si le tambour est en rotation\nTHEN THE lave-linge SHALL maintenir le hublot verrouillé.",
    priority: 'high', source: 'Normes', marches: 'EU, US, CN, JP',
    rationale: 'IEC 60335-2-7 §20 — accès aux parties mobiles.',
    acceptanceCriteria: '- [ ] Ouverture impossible à 51 °C\n- [ ] Ouverture impossible tambour à 30 tr/min',
  } },
  P4: { status: 'approved' },
})
req('produit', 'PRD-0009', PRD, 'Réglementaire', 'Protection anti-débordement', {
  P2: { status: 'draft', fields: {
    statement: "IF le niveau d'eau dépasse le niveau de sécurité\nTHEN THE lave-linge SHALL fermer les électrovannes et activer la pompe de vidange en moins de 2 s.",
    priority: 'high', source: 'Normes', marches: 'EU, US, CN, JP',
    acceptanceCriteria: '- [ ] Électrovannes fermées < 2 s\n- [ ] Aucune fuite sur 10 déclenchements',
  } },
  P4: { status: 'approved' },
})
req('produit', 'PRD-0010', PRD, 'Connectivité', 'Pilotage à distance par application', {
  P2: { status: 'draft', fields: {
    statement: "WHERE le module Wi-Fi est appairé\nTHE lave-linge SHALL permettre le démarrage et le suivi du cycle depuis l'application mobile.",
    priority: 'low', source: 'Marketing', marches: 'EU, CN', claim: true, reference_client: 'CLI-0042',
    acceptanceCriteria: '- [ ] Démarrage à distance < 5 s après l\'ordre',
  } },
  P4: { status: 'review', jiraLinks: [{
    key: 'LL-128', type: 'IMPLEMENTS', summary: 'Appli mobile — pilotage à distance du cycle', status: 'In Progress',
    url: 'https://demo-ll800.atlassian.net/browse/LL-128', linkedAt: '2026-04-22T09:00:00.000Z', linkedBy: 'Claire Martin',
  }] },
})
req('produit', 'PRD-0011', PRD, 'Usage', 'Mode silence nocturne', {
  P2: { status: 'draft', fields: {
    statement: 'THE lave-linge SHALL limiter la vitesse d\'essorage à 800 tr/min entre 22 h et 7 h.',
    priority: 'low', source: 'Marketing', marches: 'EU',
  } },
  P4: { status: 'review' },
  P6: { status: 'obsolete', fields: { rationale: 'Abandonnée en revue post-EVT : remplacée par le départ différé.' } },
})
req('produit', 'PRD-0012', PRD, 'Usage', 'Facilité d\'entretien du filtre', {
  // Énoncé volontairement NON conforme EARS (brouillon) — cible du validateur EARS et du dashboard Maturité.
  P6: { status: 'draft', fields: {
    statement: 'Le filtre de la pompe doit être facile d\'accès, sans outil.',
    priority: 'high', source: 'Retour terrain', reference_client: 'CLI-12',
  } },
})
req('produit', 'PRD-0013', PRD, 'Usage', 'Séchage intégré', {
  P6: { status: 'draft', fields: {
    statement: 'WHERE la fonction séchage est présente\nTHE lave-linge SHALL sécher une charge de 5 kg en moins de 3 h.',
    priority: 'low', source: 'Marketing', marches: 'CN, JP',
  } },
  P7: { status: 'rejected', fields: { rationale: 'Rejetée : hors périmètre de la plateforme LL800 (coût, encombrement).' } },
})

// ── Produit : exigences système (SYS) ──

const SYS = 'root::exigence-systeme'
req('produit', 'SYS-0001', SYS, 'Architecture', 'Architecture fonctionnelle', {
  P2: { status: 'draft', fields: {
    statement: 'THE lave-linge SHALL s\'articuler autour d\'une carte de commande maîtresse pilotant le moteur, la pompe de vidange, les électrovannes, l\'IHM et le module Wi-Fi via le bus interne.\n\n'
      + drawioBlock({ path: 'diagrams/architecture-systeme.drawio' }),
    priority: 'high', securite: false, domaine: 'HW', diagramme: 'diagrams/architecture-systeme.drawio',
    acceptanceCriteria: '- [ ] Chaque bloc du diagramme a au moins une exigence allouée',
    notes: 'Diagramme de référence maintenu par H. Bernard.\nToute modification passe en revue système.',
    derniere_revue: '2026-04-24T16:00:00.000Z',
  } },
  P4: { status: 'approved' },
})
req('produit', 'SYS-0002', SYS, 'Cycle de lavage', "Profil de vitesse d'essorage", {
  P2: { status: 'draft', fields: {
    statement: "WHEN la phase d'essorage démarre\nTHE carte de commande SHALL commander au moteur une rampe jusqu'à {comp-moteur::vitesse_essorage_max} en moins de 90 s.\n\n"
      + imageBlock({ src: 'images/courbe-essorage.png', alt: "Profil de vitesse d'essorage", width: 420 }),
    priority: 'high', domaine: 'SW', securite: false,
    acceptanceCriteria: '- [ ] Vitesse cible atteinte < 90 s\n- [ ] Pas de dépassement > 3 %',
  } },
  P4: { status: 'approved' },
  // Modifiée après EVT : repasse en review (a quitté l'approbation) — ses voisins sont marqués « impact à vérifier ».
  P6: { status: 'review', version: 2, fields: {
    statement: "WHEN la phase d'essorage démarre\nTHE carte de commande SHALL commander au moteur une rampe jusqu'à {comp-moteur::vitesse_essorage_max} en moins de 60 s.\n\n"
      + imageBlock({ src: 'images/courbe-essorage.png', alt: "Profil de vitesse d'essorage", width: 420 }),
    acceptanceCriteria: '- [ ] Vitesse cible atteinte < 60 s\n- [ ] Pas de dépassement > 3 %',
  } },
})
req('produit', 'SYS-0003', SYS, 'Cycle de lavage', 'Machine d\'états du cycle', {
  P2: { status: 'draft', fields: {
    statement: 'THE logiciel de commande SHALL enchaîner les phases Remplissage → Lavage → Rinçage → Essorage → Fin conformément à la machine d\'états ci-dessous.\n\n'
      + drawioBlock({ path: 'diagrams/machine-etats-cycle.drawio', nodeId: 'node-etat-lavage', width: 640 }),
    priority: 'high', domaine: 'SW', diagramme: 'diagrams/machine-etats-cycle.drawio',
    acceptanceCriteria: '- [ ] Chaque transition du diagramme est couverte par un test logiciel',
  } },
  P4: { status: 'approved' },
})
req('produit', 'SYS-0004', SYS, 'Sécurité', 'Détection de balourd', {
  P2: { status: 'draft', fields: {
    statement: 'IF le balourd mesuré dépasse 400 g·cm à 300 tr/min\nTHEN THE système SHALL redistribuer le linge et limiter la vitesse d\'essorage à 600 tr/min.',
    priority: 'high', securite: true, domaine: 'SW',
    acceptanceCriteria: '- [ ] Balourd de 500 g·cm détecté sur 10 essais sur 10',
  } },
  P4: { status: 'approved' },
})
req('produit', 'SYS-0005', SYS, 'Cycle de lavage', 'Remplissage', {
  P2: { status: 'draft', fields: {
    statement: 'WHEN la phase de remplissage démarre\nTHE système SHALL atteindre le niveau cible en moins de 3 min pour une pression d\'alimentation comprise entre {pression_eau_min} et {pression_eau_max}.\n\n'
      + drawioBlock({ path: 'diagrams/circuit-hydraulique.drawio', nodeId: 'node-cuve', crop: { x: 200, y: 0, width: 520, height: 240 } }),
    priority: 'medium', domaine: 'HYDRAU', diagramme: 'diagrams/circuit-hydraulique.drawio',
  } },
  P4: { status: 'approved' },
})
req('produit', 'SYS-0006', SYS, 'Cycle de lavage', 'Vidange', {
  P2: { status: 'draft', fields: {
    statement: 'WHEN la phase de vidange démarre\nTHE système SHALL évacuer la totalité de l\'eau en moins de 90 s au moyen de la pompe de débit {comp-pompe-vidange::debit_nominal}.',
    priority: 'medium', domaine: 'HYDRAU',
  } },
  P4: { status: 'approved' },
})
req('produit', 'SYS-0007', SYS, 'Énergie', 'Régulation de température de l\'eau', {
  P2: { status: 'draft', fields: {
    statement: 'WHILE la phase de lavage à 60 °C est active\nTHE système SHALL réguler la température de l\'eau à ± 3 °C.',
    priority: 'medium', domaine: 'THERMIQUE',
  } },
  P4: { status: 'review' },
})
req('produit', 'SYS-0008', SYS, 'Sécurité', 'Surchauffe de la résistance', {
  P2: { status: 'draft', fields: {
    statement: 'IF la température de la résistance dépasse 110 °C\nTHEN THE système SHALL couper l\'alimentation de la résistance en moins de 1 s.',
    priority: 'high', securite: true, domaine: 'THERMIQUE',
    acceptanceCriteria: '- [ ] Coupure mesurée < 1 s sur 5 essais',
  } },
  P4: { status: 'approved' },
})
req('produit', 'SYS-0009', SYS, 'Énergie', 'Consommation en veille', {
  P2: { status: 'draft', fields: {
    statement: 'WHILE le lave-linge est en veille\nTHE système SHALL consommer moins de {puissance_veille_max}.\n\n'
      + '| Mode | Puissance max. | Mesure |\n| --- | --- | --- |\n| Arrêt | 0,3 W | Wattmètre classe 0,5 |\n| Veille | {puissance_veille_max} | Wattmètre classe 0,5 |\n| Veille réseau (Wi-Fi) | 2 W | Wattmètre classe 0,5 |',
    priority: 'medium', domaine: 'HW',
    acceptanceCriteria: '- [ ] Mesure sur 10 min selon EN 50564',
  } },
  P4: { status: 'approved' },
})
req('produit', 'SYS-0010', SYS, 'Sécurité', 'Reprise après coupure secteur', {
  P2: { status: 'draft', fields: {
    statement: 'IF l\'alimentation secteur est interrompue pendant un cycle\nTHEN THE système SHALL reprendre le cycle à la phase interrompue au retour du secteur.',
    priority: 'medium', domaine: 'SW',
  } },
  P4: { status: 'approved' },
})
req('produit', 'SYS-0011', SYS, 'Énergie', 'Bruit de la pompe de vidange', {
  P2: { status: 'draft', fields: {
    // {comp-pompe-vidange::bruit_max} : paramètre présent mais vide → référence non résolue.
    statement: 'WHILE la pompe de vidange fonctionne\nTHE système SHALL limiter le bruit émis à {comp-pompe-vidange::bruit_max}.',
    priority: 'low', domaine: 'MECA',
  } },
})
req('produit', 'SYS-0012', SYS, 'Sécurité', 'Détection de fermeture du hublot', {
  P2: { status: 'draft', fields: {
    // {effort_fermeture_hublot} : absent de la base → reste littéral (saisi à la main en campagne s'il figurait dans un test).
    statement: 'WHEN l\'utilisateur ferme le hublot\nTHE système SHALL détecter la fermeture pour un effort inférieur à {effort_fermeture_hublot}.',
    priority: 'high', securite: true, domaine: 'MECA',
  } },
  P4: { status: 'review' },
})
req('produit', 'SYS-0013', SYS, 'Architecture', 'Remontée d\'état vers le module Wi-Fi', {
  P6: { status: 'draft', fields: {
    statement: 'WHERE le module Wi-Fi est présent\nTHE carte de commande SHALL lui transmettre l\'état du cycle toutes les 5 s.',
    priority: 'low', domaine: 'SW',
  } },
})
req('produit', 'SYS-0014', SYS, 'Sécurité', 'Commande du verrou de hublot', {
  P2: { status: 'draft', fields: {
    statement: 'IF le tambour tourne ou si la température de l\'eau dépasse 50 °C\nTHEN THE carte de commande SHALL maintenir le verrou de hublot alimenté.',
    priority: 'high', securite: true, domaine: 'HW', diagramme: 'diagrams/architecture-systeme.drawio',
  } },
  P4: { status: 'approved' },
})

// ── Produit › hydraulique (HYD) › électrovannes (EV) ──

const HYD = 'hydraulique::exigence-hydraulique'
req('produit', 'HYD-0001', HYD, 'Alimentation', "Débit d'arrivée d'eau", {
  P2: { status: 'draft', fields: { statement: "THE circuit hydraulique SHALL admettre un débit d'au moins 8 L/min à {pression_eau_min}.", priority: 'medium', debit_l_min: 8 } },
  P4: { status: 'approved' },
})
req('produit', 'HYD-0002', HYD, 'Mesure', 'Capteur de niveau', {
  P2: { status: 'draft', fields: { statement: "THE circuit hydraulique SHALL mesurer le niveau d'eau en cuve avec une résolution de 5 mm.", priority: 'high' } },
  P4: { status: 'approved' },
})
req('produit', 'HYD-0003', HYD, 'Alimentation', 'Étanchéité', {
  P2: { status: 'draft', fields: {
    statement: 'THE circuit hydraulique SHALL rester étanche sous une pression de 1,2 × {pression_eau_max}.',
    priority: 'high', acceptanceCriteria: '- [ ] Aucune fuite après 10 min à 1,2 MPa',
  } },
  P4: { status: 'approved' },
})
req('produit', 'HYD-0004', HYD, 'Alimentation', 'Anti-siphonnage', {
  P2: { status: 'draft', fields: { statement: 'IF la pression d\'arrivée devient négative\nTHEN THE circuit hydraulique SHALL empêcher tout retour d\'eau vers le réseau.', priority: 'high' } },
})
const EV = 'electrovannes::exigence-electrovanne'
req('produit', 'EV-0001', EV, null, 'Électrovanne de prélavage', {
  P2: { status: 'draft', fields: { statement: 'WHEN la phase de prélavage démarre\nTHE électrovanne de prélavage SHALL s\'ouvrir en moins de 200 ms.', priority: 'medium' } },
  P4: { status: 'approved' },
})
req('produit', 'EV-0002', EV, null, 'Électrovanne de lavage', {
  P2: { status: 'draft', fields: { statement: 'WHEN la phase de lavage démarre\nTHE électrovanne de lavage SHALL s\'ouvrir en moins de 200 ms.', priority: 'medium' } },
  P4: { status: 'approved' },
})
req('produit', 'EV-0003', EV, null, 'Fermeture sans alimentation', {
  P2: { status: 'draft', fields: { statement: 'IF l\'alimentation de l\'électrovanne est coupée\nTHEN THE électrovanne SHALL se fermer.', priority: 'high', securite: true } },
  P4: { status: 'approved' },
})

// ── Produit › carte de commande (CC) › logiciel (SW) ──

const CC = 'carte-commande::exigence-carte'
req('produit', 'CC-0001', CC, null, 'Microcontrôleur principal', {
  P2: { status: 'draft', fields: { statement: 'THE carte de commande SHALL embarquer un microcontrôleur 32 bits disposant d\'au moins 256 Ko de flash.', priority: 'medium', composant_ref: 'STM32G0B1' } },
  P4: { status: 'approved' },
})
req('produit', 'CC-0002', CC, null, 'Alimentation secteur', {
  P2: { status: 'draft', fields: { statement: 'THE carte de commande SHALL fonctionner pour une tension secteur de {tension_alimentation} ± 10 %.', priority: 'high', securite: true } },
  P4: { status: 'approved' },
})
req('produit', 'CC-0003', CC, null, 'Pilotage de la résistance', {
  P2: { status: 'draft', fields: { statement: 'THE carte de commande SHALL piloter la résistance de chauffe par relais avec double coupure.', priority: 'high', securite: true } },
  P4: { status: 'approved' },
})
req('produit', 'CC-0004', CC, 'Interfaces', 'Contrôleur du bus interne', {
  P2: { status: 'draft', fields: { statement: 'THE carte de commande SHALL assurer le rôle de contrôleur du bus interne conformément au protocole if-bus-interne.', priority: 'high' } },
  P4: { status: 'approved' },
})
req('produit', 'CC-0005', CC, 'Interfaces', 'Maître du bus IHM', {
  P2: { status: 'draft', fields: { statement: 'THE carte de commande SHALL assurer le rôle de maître du bus IHM.', priority: 'medium' } },
  P4: { status: 'approved' },
})
const SW = 'logiciel::exigence-logiciel'
req('produit', 'SW-0001', SW, 'FSM', 'Séquenceur de cycle', {
  P2: { status: 'draft', fields: { statement: 'THE logiciel de commande SHALL implémenter la machine d\'états du cycle définie par SYS-0003.', priority: 'high', module: 'FSM', classe_logicielle: 'B' } },
  P4: { status: 'approved' },
})
req('produit', 'SW-0002', SW, 'Sécurité', 'Chien de garde', {
  P2: { status: 'draft', fields: { statement: 'IF le chien de garde n\'est pas rafraîchi pendant 100 ms\nTHEN THE logiciel de commande SHALL placer le système en état sûr.', priority: 'high', securite: true, module: 'Sécurité', classe_logicielle: 'B' } },
  P4: { status: 'approved' },
})
req('produit', 'SW-0003', SW, 'FSM', 'Sauvegarde de contexte', {
  P2: { status: 'draft', fields: { statement: 'WHEN une chute de tension secteur est détectée\nTHE logiciel de commande SHALL sauvegarder la phase en cours en mémoire non volatile en moins de 10 ms.', priority: 'medium', module: 'FSM', classe_logicielle: 'A' } },
  P4: { status: 'approved' },
})
req('produit', 'SW-0004', SW, 'IHM', 'Gestion du départ différé', {
  P2: { status: 'draft', fields: { statement: 'WHERE le départ différé est programmé\nTHE logiciel de commande SHALL décompter le délai et démarrer le cycle à son terme.', priority: 'medium', module: 'IHM', classe_logicielle: 'A' } },
  P4: { status: 'review' },
})
req('produit', 'SW-0005', SW, 'IHM', 'Verrouillage des touches', {
  P2: { status: 'draft', fields: { statement: 'WHILE la sécurité enfant est active\nTHE logiciel de commande SHALL ignorer les événements touches hors combinaison de déverrouillage.', priority: 'high', module: 'IHM', classe_logicielle: 'A' } },
  P4: { status: 'approved' },
})
req('produit', 'SW-0006', SW, 'Diagnostic', 'Journal de défauts', {
  P2: { status: 'draft', fields: { statement: 'WHEN un défaut est détecté\nTHE logiciel de commande SHALL l\'horodater et l\'enregistrer dans un journal circulaire de 32 entrées.', priority: 'low', module: 'Diagnostic', classe_logicielle: 'A' } },
})

// ── Produit › bus IHM (interface locale, BIHM) & IHM ──

const BIHM = 'bus-ihm::exigence-bus-ihm'
req('produit', 'BIHM-0001', BIHM, null, 'Trame de rafraîchissement', {
  P2: { status: 'draft', fields: { statement: 'THE maître du bus IHM SHALL émettre une trame de rafraîchissement de l\'affichage toutes les 50 ms.', roles: 'maitre' } },
  P4: { status: 'approved' },
})
req('produit', 'BIHM-0002', BIHM, null, 'Acquittement des touches', {
  P2: { status: 'draft', fields: { statement: 'WHEN une touche est appuyée\nTHE esclave du bus IHM SHALL signaler l\'événement au maître dans la trame suivante.', roles: 'esclave' } },
  P4: { status: 'approved' },
})
req('produit', 'BIHM-0003', BIHM, null, 'Timeout de communication', {
  P2: { status: 'draft', fields: { statement: 'IF aucune trame n\'est reçue pendant 500 ms\nTHEN THE participant du bus IHM SHALL signaler un défaut de communication.', roles: 'maitre, esclave' } },
  P4: { status: 'approved' },
})
req('produit', 'BIHM-0004', BIHM, null, 'Adressage', {
  // Pas de rôle → s'applique à tous les implémenteurs.
  P2: { status: 'draft', fields: { statement: 'THE bus IHM SHALL utiliser un adressage sur 7 bits.' } },
  P4: { status: 'approved' },
})
const IHM = 'ihm::exigence-ihm'
req('produit', 'IHM-0001', IHM, null, 'Affichage du temps restant', {
  P2: { status: 'draft', fields: {
    statement: 'WHILE un cycle est en cours\nTHE IHM SHALL afficher le temps restant en heures et minutes.',
    priority: 'medium',
    maquette: 'Maquette de la façade :\n\n![Façade IHM](images/facade-ihm.png)\n\nLe temps restant occupe les 4 digits centraux.',
  } },
  P4: { status: 'approved' },
})
req('produit', 'IHM-0002', IHM, null, 'Touches capacitives', {
  P2: { status: 'draft', fields: { statement: 'THE IHM SHALL détecter un appui sur une touche capacitive en moins de 100 ms, y compris avec des doigts humides.', priority: 'medium' } },
  P4: { status: 'approved' },
})
req('produit', 'IHM-0003', IHM, null, 'Signal sonore de fin de cycle', {
  P2: { status: 'draft', fields: { statement: 'WHEN le cycle se termine\nTHE IHM SHALL émettre trois bips, désactivables par l\'utilisateur.', priority: 'low' } },
  P4: { status: 'approved' },
})
req('produit', 'IHM-0004', IHM, null, 'Conformité au bus IHM', {
  P2: { status: 'draft', fields: { statement: 'THE IHM SHALL se comporter en esclave du bus IHM.', priority: 'medium' } },
  P4: { status: 'approved' },
})

// ── Produit : tests système (TSYS) ──

const TSYS = 'root::test-systeme'
tst('produit', 'TSYS-0001', TSYS, 'Performance', 'Mesure de la capacité de charge', {
  P3: { status: 'draft', fields: { niveau: 'système', duree_min: 30, destructif: false, moyens: 'Balance' },
    preconditions: 'Charge normalisée EN 60456 conditionnée 24 h à 20 °C / 65 % HR.',
    equipment: [{ id: 'eq-balance', role: 'Balance', description: 'Balance 0–20 kg, résolution 10 g', required: true, quantity: 1 }],
    steps: steps(
      ['Peser la charge de linge sec.', 'Masse = {capacite_kg} ± 1 %'],
      ['Introduire la charge dans le tambour et fermer le hublot.', 'Hublot fermé sans effort anormal.'],
      ['Lancer le programme Coton 40 °C.', 'Le cycle démarre sans défaut de balourd.'],
    ),
    postconditions: 'Vider le tambour, consigner la masse mesurée.' },
  P4: { status: 'approved' },
})
tst('produit', 'TSYS-0002', TSYS, 'Performance', "Mesure de la vitesse d'essorage", {
  P3: { status: 'draft', fields: { niveau: 'système', duree_min: 20, moyens: 'Tachymètre' },
    preconditions: 'Charge nominale de {capacite_kg}, programme Coton.',
    equipment: [{ id: 'eq-tacho', role: 'Tachymètre optique', description: 'Plage 0–3000 tr/min', required: true, quantity: 1 }],
    steps: steps(
      ['Lancer le programme Coton avec essorage maximal.', 'Le cycle atteint la phase d\'essorage.'],
      ['Mesurer la vitesse du tambour au tachymètre pendant le palier.', 'Vitesse ≥ {vitesse_essorage} − 2 %, et ≤ {comp-moteur::vitesse_essorage_max}.', 'Relever la valeur maximale sur 30 s.'],
    ),
    postconditions: '' },
  P4: { status: 'approved' },
  P6: { needsRevalidation: true },
})
tst('produit', 'TSYS-0003', TSYS, 'Performance', "Consommation d'eau Eco 40-60", {
  P3: { status: 'draft', fields: { niveau: 'système', duree_min: 240, moyens: 'Banc hydraulique, Balance' },
    // {charge_essai} : absent de la base → saisi à la main à l'ajout en campagne (paramValues).
    preconditions: 'Charge d\'essai de {charge_essai}, eau à 15 °C ± 2 °C.',
    equipment: [{ id: 'eq-debitmetre', role: 'Débitmètre', description: 'Compteur volumétrique classe B', required: true, quantity: 1 }],
    steps: steps(
      ['Lancer le programme Eco 40-60.', 'Le cycle démarre.'],
      ['Relever le volume d\'eau consommé en fin de cycle.', 'Volume ≤ {consommation_eau_eco}.'],
      ['Relever la durée du cycle.', 'Durée ≤ {duree_programme_eco}.'],
    ),
    postconditions: 'Répéter 3 fois et consigner la moyenne.' },
  P4: { status: 'approved' },
})
tst('produit', 'TSYS-0004', TSYS, 'Performance', 'Mesure acoustique en essorage', {
  P3: { status: 'draft', fields: { niveau: 'système', duree_min: 60, moyens: 'Sonomètre' },
    preconditions: 'Salle semi-anéchoïque, machine sur socle normalisé.',
    equipment: [{ id: 'eq-sono', role: 'Sonomètre', description: 'Classe 1 IEC 61672', required: true, quantity: 4 }],
    steps: steps(
      ['Lancer un essorage à vitesse maximale.', 'Palier de vitesse atteint.'],
      ['Mesurer la puissance acoustique selon IEC 60704-2-4.', 'L_WA < {niveau_sonore_essorage}.'],
    ),
    postconditions: '' },
  P4: { status: 'approved' },
})
tst('produit', 'TSYS-0005', TSYS, 'KPI', 'Vérification des KPI produit (itératif par exigence)', {
  // Test itérant (T179) : {req.<champ>} → une instance de campagne par exigence liée.
  P3: { status: 'draft', fields: { niveau: 'système', duree_min: 15 },
    preconditions: 'Exigence vérifiée : **{req.id}** — {req.title}.',
    equipment: [],
    steps: steps(
      ['Relever la mesure correspondant à l\'exigence {req.id}.', 'La mesure respecte le KPI cible : {req.kpi_cible}.'],
      ['Consigner la mesure dans le rapport de campagne.', 'Mesure consignée avec la référence {req.id}.'],
    ),
    postconditions: '' },
  P4: { status: 'approved' },
})
tst('produit', 'TSYS-0006', TSYS, 'Sécurité', 'Verrouillage du hublot', {
  P3: { status: 'draft', fields: { niveau: 'intégration', duree_min: 45, moyens: 'Chambre climatique' },
    preconditions: 'Machine alimentée, programme 60 °C.',
    equipment: [],
    steps: steps(
      ['Pendant le chauffage, attendre que l\'eau atteigne 51 °C, puis tenter d\'ouvrir le hublot.', 'Le hublot reste verrouillé.'],
      ['Pendant l\'essorage, tenter d\'ouvrir le hublot.', 'Le hublot reste verrouillé.'],
      ['En fin de cycle, eau < 45 °C et tambour arrêté, ouvrir le hublot.', 'Le hublot se déverrouille en moins de 2 min.'],
    ),
    postconditions: '' },
  P4: { status: 'approved' },
})
tst('produit', 'TSYS-0007', TSYS, 'Sécurité', 'Protection anti-débordement', {
  P3: { status: 'draft', fields: { niveau: 'système', duree_min: 90, destructif: false, moyens: 'Banc hydraulique' },
    preconditions: 'Électrovanne de lavage forcée ouverte par le banc.',
    equipment: [{ id: 'eq-banc-hydrau', role: 'Banc hydraulique', description: 'Banc de forçage des électrovannes', required: true, quantity: 1 }],
    steps: steps(
      ['Forcer le remplissage au-delà du niveau de sécurité.', 'Les électrovannes se ferment en moins de 2 s.'],
      ['Observer la pompe de vidange.', 'La pompe démarre en moins de 2 s.'],
      ['Répéter 10 fois.', 'Aucune fuite constatée.'],
    ),
    postconditions: 'Remettre le banc en configuration nominale.' },
  P4: { status: 'approved' },
})
tst('produit', 'TSYS-0008', TSYS, 'Sécurité', 'Détection de balourd', {
  P3: { status: 'draft', fields: { niveau: 'endurance', duree_min: 600, destructif: true, moyens: 'Balance' },
    preconditions: 'Masse de balourd de 500 g fixée sur la paroi du tambour.',
    equipment: [],
    steps: steps(
      ['Lancer un essorage.', 'Le système détecte le balourd à 300 tr/min.'],
      ['Observer la suite du cycle.', 'Redistribution puis essorage limité à 600 tr/min.'],
    ),
    postconditions: '' },
  P4: { status: 'review' },
})
tst('produit', 'TSYS-0009', TSYS, 'Énergie', 'Consommation en veille', {
  P3: { status: 'draft', fields: { niveau: 'système', duree_min: 20, moyens: 'Wattmètre' },
    preconditions: 'Machine en veille depuis 30 min.',
    equipment: [{ id: 'eq-watt', role: 'Wattmètre', description: 'Classe 0,5, résolution 10 mW', required: true, quantity: 1 }],
    steps: steps(['Mesurer la puissance moyenne sur 10 min.', 'Puissance < {puissance_veille_max}.']),
    postconditions: '' },
  P4: { status: 'approved' },
})
tst('produit', 'TSYS-0010', TSYS, 'Sécurité', 'Reprise après coupure secteur', {
  P3: { status: 'draft', fields: { niveau: 'intégration', duree_min: 30 },
    preconditions: '',
    equipment: [],
    steps: steps(
      ['Couper le secteur pendant la phase de rinçage.', 'La machine s\'arrête.'],
      ['Rétablir le secteur après 30 s.', 'Le cycle reprend à la phase de rinçage.'],
    ),
    postconditions: '' },
  P4: { status: 'approved' },
})
tst('produit', 'TSYS-0011', TSYS, 'Énergie', 'Bruit de la pompe de vidange', {
  // Références non résolues : nœud inconnu ({comp-inexistant::…}) et paramètre vide ({comp-pompe-vidange::bruit_max}).
  P6: { status: 'draft', fields: { niveau: 'intégration', duree_min: 30, moyens: 'Sonomètre' },
    preconditions: 'Pompe alimentée sur banc, référence fournisseur {comp-inexistant::ref_pompe}.',
    equipment: [],
    steps: steps(['Mesurer le bruit de la pompe pendant la vidange.', 'Bruit ≤ {comp-pompe-vidange::bruit_max}.']),
    postconditions: '' },
})

// ── Produit : tests hydraulique & logiciel ──

const THYD = 'hydraulique::test-hydraulique'
tst('produit', 'THYD-0001', THYD, null, 'Étanchéité sous pression', {
  P3: { status: 'draft', fields: { banc: 'Banc pression B2' },
    preconditions: 'Circuit rempli, purgé.', equipment: [],
    steps: steps(['Monter en pression à 1,2 × {pression_eau_max}.', 'Pression stable.'], ['Maintenir 10 min.', 'Aucune fuite.']),
    postconditions: '' },
  P4: { status: 'approved' },
})
tst('produit', 'THYD-0002', THYD, null, "Débit d'arrivée", {
  P3: { status: 'draft', fields: { banc: 'Banc pression B2' },
    preconditions: 'Pression d\'alimentation réglée à {pression_eau_min}.', equipment: [],
    steps: steps(['Ouvrir l\'électrovanne de lavage et mesurer le débit.', 'Débit ≥ 8 L/min.']),
    postconditions: '' },
  P4: { status: 'approved' },
})
const TSW = 'logiciel::test-logiciel'
tst('produit', 'TSW-0001', TSW, null, 'Parcours nominal de la machine d\'états', {
  P3: { status: 'draft', fields: { automatise: true, version_firmware: '1.2.0' },
    preconditions: 'Firmware flashé sur banc HIL.', equipment: [],
    steps: steps(
      ['Simuler un cycle Coton complet.', 'Transitions Remplissage → Lavage → Rinçage → Essorage → Fin observées.'],
      ['Vérifier le journal de transitions.', 'Aucune transition hors diagramme.'],
    ),
    postconditions: '' },
  P4: { status: 'approved' },
})
tst('produit', 'TSW-0002', TSW, null, 'Chien de garde', {
  P3: { status: 'draft', fields: { automatise: true, version_firmware: '1.2.0' },
    preconditions: '', equipment: [],
    steps: steps(['Bloquer la tâche principale (point d\'arrêt injecté).', 'Reset par chien de garde en < 100 ms, système en état sûr.']),
    postconditions: '' },
  P4: { status: 'approved' },
})
tst('produit', 'TSW-0003', TSW, null, 'Sécurité enfant', {
  P3: { status: 'draft', fields: { automatise: false, version_firmware: '1.2' }, // version_firmware non conforme au validateur regex
    preconditions: 'Sécurité enfant activée.', equipment: [],
    steps: steps(
      ['Appuyer brièvement sur chaque touche.', 'Aucun effet.'],
      ['Appui long 3 s sur la combinaison de déverrouillage.', 'Sécurité enfant désactivée.'],
    ),
    postconditions: '' },
  P4: { status: 'approved' },
})

// ── Composant moteur ──

const MOT = 'root::exigence-moteur'
req('moteur', 'MOT-0001', MOT, 'Performance', 'Vitesse maximale', {
  P2: { status: 'draft', fields: { statement: 'THE moteur SHALL entraîner le tambour jusqu\'à {vitesse_essorage_max} à pleine charge.', priority: 'high', couple_nm: 0.4 } },
  P4: { status: 'approved' },
  P6: { needsRevalidation: true },
})
req('moteur', 'MOT-0002', MOT, 'Performance', 'Couple nominal', {
  P2: { status: 'draft', fields: { statement: 'THE moteur SHALL délivrer un couple de {couple_nominal} en phase de lavage.', priority: 'medium', couple_nm: 1.2 } },
  P4: { status: 'approved' },
})
req('moteur', 'MOT-0003', MOT, 'Protection', 'Protection thermique du bobinage', {
  P2: { status: 'draft', fields: { statement: 'IF la température du bobinage dépasse {temp_max_bobinage}\nTHEN THE moteur SHALL être mis hors tension.', priority: 'high', securite: true } },
  P4: { status: 'approved' },
})
req('moteur', 'MOT-0004', MOT, 'Protection', 'Protection contre les surintensités', {
  P2: { status: 'draft', fields: { statement: 'IF le courant de phase dépasse {courant_max}\nTHEN THE onduleur SHALL couper les commandes de grille en moins de 10 µs.', priority: 'high', securite: true } },
  P4: { status: 'approved' },
})
req('moteur', 'MOT-0005', MOT, 'Performance', 'Mesure du balourd', {
  P2: { status: 'draft', fields: { statement: 'WHILE le tambour tourne à 300 tr/min\nTHE moteur SHALL estimer le balourd à partir de l\'ondulation de couple.', priority: 'medium' } },
  P4: { status: 'approved' },
})
req('moteur', 'MOT-0006', MOT, 'Interfaces', 'Périphérique du bus interne', {
  P2: { status: 'draft', fields: { statement: 'THE moteur SHALL se comporter en périphérique du bus interne.', priority: 'high' } },
  P4: { status: 'approved' },
  P6: { needsRevalidation: true },
})
req('moteur', 'MOT-0007', MOT, 'Performance', "Rendement de l'onduleur", {
  P2: { status: 'draft', fields: {
    statement: 'THE onduleur SHALL présenter un rendement supérieur à {rendement_min} à charge nominale.\n\n' + drawioBlock({ path: 'diagrams/onduleur.drawio', width: 520 }),
    priority: 'medium',
  } },
  P8: { status: 'review' },
})
const FWM = 'firmware-moteur::exigence-fw-moteur'
req('moteur', 'FWM-0001', FWM, null, 'Contrôle vectoriel (FOC)', {
  P2: { status: 'draft', fields: { statement: 'THE firmware moteur SHALL réguler la vitesse par contrôle vectoriel sans capteur à 16 kHz.', priority: 'high' } },
  P4: { status: 'approved' },
})
req('moteur', 'FWM-0002', FWM, null, 'Estimation de charge', {
  P2: { status: 'draft', fields: { statement: 'WHEN le cycle démarre\nTHE firmware moteur SHALL estimer la masse de linge à ± 0,5 kg.', priority: 'medium' } },
  P4: { status: 'approved' },
})
req('moteur', 'FWM-0003', FWM, null, 'Arrêt sûr', {
  P2: { status: 'draft', fields: { statement: 'IF un défaut onduleur est détecté\nTHEN THE firmware moteur SHALL freiner le tambour en court-circuitant les phases basses.', priority: 'high', securite: true } },
  P4: { status: 'approved' },
})
const TMOT = 'root::test-moteur'
tst('moteur', 'TMOT-0001', TMOT, null, 'Montée en vitesse', {
  P3: { status: 'draft', fields: { banc: 'Banc dynamométrique' }, preconditions: 'Tambour chargé à {couple_nominal}.', equipment: [],
    steps: steps(['Commander une consigne à {vitesse_essorage_max}.', 'Vitesse atteinte en moins de 60 s.']), postconditions: '' },
  P4: { status: 'approved' },
})
tst('moteur', 'TMOT-0002', TMOT, null, 'Protection thermique', {
  P3: { status: 'draft', fields: { banc: 'Banc thermique' }, preconditions: '', equipment: [],
    steps: steps(['Chauffer le bobinage jusqu\'à {temp_max_bobinage}.', 'Mise hors tension du moteur.']), postconditions: '' },
  P4: { status: 'approved' },
})
tst('moteur', 'TMOT-0003', TMOT, null, 'Coupure sur surintensité', {
  P3: { status: 'draft', fields: { banc: 'Banc HIL' }, preconditions: '', equipment: [],
    steps: steps(['Injecter un courant de phase de 1,2 × {courant_max}.', 'Coupure des grilles en moins de 10 µs.']), postconditions: '' },
  P4: { status: 'approved' },
})
tst('moteur', 'TMOT-0004', TMOT, null, 'Couple nominal', {
  P3: { status: 'draft', fields: { banc: 'Banc dynamométrique' }, preconditions: '', equipment: [],
    steps: steps(['Mesurer le couple en régime de lavage.', 'Couple ≥ {couple_nominal}.']), postconditions: '' },
})

// ── Composant pompe de vidange ──

const POMP = 'root::exigence-pompe'
req('pompe', 'POMP-0001', POMP, null, 'Débit nominal', {
  P2: { status: 'draft', fields: { statement: 'THE pompe SHALL délivrer un débit de {debit_nominal} à {hauteur_refoulement} de hauteur de refoulement.', priority: 'high' } },
  P4: { status: 'approved' },
})
req('pompe', 'POMP-0002', POMP, null, 'Hauteur de refoulement', {
  P2: { status: 'draft', fields: { statement: 'THE pompe SHALL refouler l\'eau jusqu\'à une hauteur de {hauteur_refoulement}.', priority: 'medium' } },
  P4: { status: 'approved' },
})
req('pompe', 'POMP-0003', POMP, null, 'Fonctionnement à sec', {
  P2: { status: 'draft', fields: { statement: 'IF la pompe fonctionne à sec pendant 10 min\nTHEN THE pompe SHALL rester intacte.', priority: 'high', securite: true } },
  P4: { status: 'approved' },
})
req('pompe', 'POMP-0004', POMP, null, 'Filtre accessible', {
  P2: { status: 'draft', fields: { statement: 'THE pompe SHALL intégrer un filtre démontable sans outil depuis la trappe avant.', priority: 'medium' } },
  P4: { status: 'review' },
})
const TPOMP = 'root::test-pompe'
tst('pompe', 'TPOMP-0001', TPOMP, null, 'Débit nominal', {
  P3: { status: 'draft', fields: {}, preconditions: '', equipment: [],
    steps: steps(['Mesurer le débit à {hauteur_refoulement}.', 'Débit ≥ {debit_nominal}.']), postconditions: '' },
  P4: { status: 'approved' },
})
tst('pompe', 'TPOMP-0002', TPOMP, null, 'Fonctionnement à sec', {
  P3: { status: 'draft', fields: {}, preconditions: '', equipment: [],
    steps: steps(['Faire fonctionner la pompe à sec 10 min.', 'Pas de dommage ; débit nominal conservé ensuite.']), postconditions: '' },
  P4: { status: 'approved' },
})

// ── Composant module Wi-Fi (aucun test : exigences non couvertes) ──

const WIFI = 'root::exigence-wifi'
req('wifi', 'WIFI-0001', WIFI, null, 'Connectivité Wi-Fi', {
  P2: { status: 'draft', fields: { statement: 'THE module Wi-Fi SHALL se connecter à un point d\'accès {bande_wifi} WPA2/WPA3.', priority: 'medium', bande: '2.4 GHz' } },
  P4: { status: 'approved' },
})
req('wifi', 'WIFI-0002', WIFI, null, 'Appairage', {
  P2: { status: 'draft', fields: { statement: 'WHEN l\'utilisateur active l\'appairage\nTHE module Wi-Fi SHALL rester détectable pendant {delai_appairage}.', priority: 'medium' } },
  P4: { status: 'review' },
})
req('wifi', 'WIFI-0003', WIFI, null, 'Mise à jour OTA', {
  P2: { status: 'draft', fields: { statement: 'WHERE une mise à jour est disponible\nTHE module Wi-Fi SHALL la télécharger et l\'installer hors cycle de lavage.', priority: 'low' } },
})
req('wifi', 'WIFI-0004', WIFI, null, 'Périphérique du bus interne', {
  P2: { status: 'draft', fields: { statement: 'THE module Wi-Fi SHALL se comporter en périphérique du bus interne.', priority: 'medium' } },
  P4: { status: 'approved' },
  P6: { needsRevalidation: true },
})

// ── Repo interface bus interne ──

const BUS = 'root::exigence-bus'
req('bus', 'BUS-0001', BUS, 'Couche physique', 'Débit du bus', {
  P2: { status: 'draft', fields: { statement: 'THE bus interne SHALL fonctionner à {debit_bus}, format 8N1.', roles: 'controller, device', version_protocole: '1.0' } },
  P4: { status: 'approved' },
})
req('bus', 'BUS-0002', BUS, 'Protocole', "Délai de réponse d'un périphérique", {
  P2: { status: 'draft', fields: { statement: 'WHEN un périphérique reçoit une requête qui lui est adressée\nTHE périphérique SHALL répondre en moins de {delai_reponse_device}.', roles: 'device', version_protocole: '1.0' } },
  P4: { status: 'approved' },
  P6: { version: 2, fields: { version_protocole: '1.1' } },
})
req('bus', 'BUS-0003', BUS, 'Protocole', 'Signalement de défaut', {
  P2: { status: 'draft', fields: { statement: 'WHEN un périphérique détecte un défaut interne\nTHE périphérique SHALL positionner le bit DEFAUT dans sa prochaine réponse.', roles: 'device', version_protocole: '1.0' } },
  P4: { status: 'approved' },
})
req('bus', 'BUS-0004', BUS, 'Protocole', 'Scrutation cyclique', {
  P2: { status: 'draft', fields: { statement: 'THE contrôleur SHALL scruter chaque périphérique toutes les {periode_scrutation}.', roles: 'controller', version_protocole: '1.0' } },
  P4: { status: 'approved' },
})
req('bus', 'BUS-0005', BUS, 'Couche physique', 'Contrôle d\'intégrité CRC-16', {
  // Pas de rôle → applicable à tous.
  P2: { status: 'draft', fields: { statement: 'THE bus interne SHALL protéger chaque trame par un CRC-16 CCITT.', version_protocole: '1.0' } },
  P4: { status: 'approved' },
})
req('bus', 'BUS-0006', BUS, 'Protocole', 'Mode veille du bus', {
  // Ajoutée en v1.1 : aucun implémenteur ne la couvre encore → cellules « manquant » dans la matrice.
  P6: { status: 'approved', fields: { statement: 'WHEN le contrôleur émet la trame VEILLE\nTHE participant du bus SHALL réduire sa consommation sous 5 mW.', roles: 'controller, device', version_protocole: '1.1' } },
})

// ─── Liens (links/links.yaml du repo `repo`) ─────────────────────────────────

export const LINKS = []
const link = (phase, repo, type, sourceId, targetId, extra = {}) => LINKS.push({ phase, repo, type, sourceId, targetId, ...extra })

// Raffinement produit → système/composants
for (const [s, t] of [
  ['PRD-0002', 'SYS-0002'], ['PRD-0003', 'SYS-0005'], ['PRD-0003', 'SYS-0007'], ['PRD-0004', 'SYS-0002'], ['PRD-0004', 'SYS-0011'],
  ['PRD-0005', 'SYS-0003'], ['PRD-0006', 'SW-0004'], ['PRD-0007', 'SW-0005'], ['PRD-0008', 'SYS-0014'], ['PRD-0009', 'SYS-0005'],
  ['PRD-0009', 'HYD-0002'], ['PRD-0011', 'SW-0004'],
]) link('P2', 'produit', 'raffinement', s, t, { by: P.claire })
link('P6', 'produit', 'raffinement', 'PRD-0010', 'SYS-0013', { by: P.claire })

// Implémentation système → composants (y compris cross-repo : SYS-0002 → MOT-0001, SYS-0006 → POMP-0001)
for (const [s, t] of [
  ['SYS-0001', 'CC-0001'], ['SYS-0002', 'MOT-0001'], ['SYS-0002', 'FWM-0001'], ['SYS-0004', 'MOT-0005'], ['SYS-0004', 'FWM-0002'],
  ['SYS-0005', 'HYD-0001'], ['SYS-0005', 'EV-0002'], ['SYS-0006', 'POMP-0001'], ['SYS-0007', 'CC-0003'], ['SYS-0008', 'CC-0003'],
  ['SYS-0003', 'SW-0001'], ['SYS-0010', 'SW-0003'], ['SYS-0014', 'CC-0002'], ['HYD-0001', 'EV-0001'], ['HYD-0001', 'EV-0002'],
  ['CC-0001', 'SW-0002'],
]) link('P2', 'produit', 'implementation', s, t, { by: P.hugo })
link('P2', 'produit', 'relation', 'SYS-0004', 'SYS-0002', { by: P.hugo })

// Vérification (test ↔ exigence)
for (const [s, t, extra] of [
  ['TSYS-0001', 'PRD-0001'], ['TSYS-0002', 'SYS-0002'], ['TSYS-0003', 'PRD-0003'], ['TSYS-0004', 'PRD-0004'],
  ['TSYS-0005', 'PRD-0001'], ['TSYS-0005', 'PRD-0002'], ['TSYS-0005', 'PRD-0003'], ['TSYS-0005', 'PRD-0004'], ['TSYS-0005', 'PRD-0005'],
  ['TSYS-0005', 'SYS-0009'], ['TSYS-0006', 'PRD-0008'], ['TSYS-0006', 'SYS-0014'], ['TSYS-0007', 'PRD-0009'],
  ['TSYS-0008', 'SYS-0004', { coverageType: 'partial' }], ['TSYS-0009', 'SYS-0009'], ['TSYS-0010', 'SYS-0010'], ['TSYS-0010', 'SW-0003'],
  ['THYD-0001', 'HYD-0003'], ['THYD-0002', 'HYD-0001'], ['TSW-0001', 'SW-0001'], ['TSW-0002', 'SW-0002'], ['TSW-0003', 'SW-0005'],
  ['TSW-0003', 'PRD-0007', { coverageType: 'partial' }],
]) link('P3', 'produit', 'verification', s, t, { by: P.marc, coverageType: 'full', ...extra })
// Lien de couverture créé « à l'envers » (depuis l'exigence) : doit être apparié quand même.
link('P3', 'produit', 'verification', 'PRD-0002', 'TSYS-0002', { by: P.claire, coverageType: 'full' })
link('P6', 'produit', 'verification', 'TSYS-0011', 'SYS-0011', { by: P.marc, coverageType: 'full' })

// Implémentation d'interfaces (matrice de conformité)
for (const t of ['BUS-0001', 'BUS-0004', 'BUS-0005']) link('P3', 'produit', 'implements-interface', 'CC-0004', t, { by: P.yann })
for (const t of ['BIHM-0001', 'BIHM-0003']) link('P3', 'produit', 'implements-interface', 'CC-0005', t, { by: P.ines }) // BIHM-0004 manquant
for (const t of ['BIHM-0002', 'BIHM-0003', 'BIHM-0004']) link('P3', 'produit', 'implements-interface', 'IHM-0004', t, { by: P.ines })

// Composant moteur
for (const [s, t] of [['TMOT-0001', 'MOT-0001'], ['TMOT-0002', 'MOT-0003'], ['TMOT-0003', 'MOT-0004'], ['TMOT-0004', 'MOT-0002']])
  link('P3', 'moteur', 'verification', s, t, { by: P.yann, coverageType: 'full' })
for (const [s, t] of [['MOT-0001', 'FWM-0001'], ['MOT-0004', 'FWM-0003'], ['MOT-0005', 'FWM-0002']])
  link('P2', 'moteur', 'implementation', s, t, { by: P.yann })
for (const t of ['BUS-0001', 'BUS-0002', 'BUS-0003', 'BUS-0005']) link('P3', 'moteur', 'implements-interface', 'MOT-0006', t, { by: P.yann })

// Composant pompe
for (const [s, t] of [['TPOMP-0001', 'POMP-0001'], ['TPOMP-0002', 'POMP-0003']])
  link('P3', 'pompe', 'verification', s, t, { by: P.sophie, coverageType: 'full' })

// Module Wi-Fi : n'implémente qu'une partie de l'interface
link('P3', 'wifi', 'implements-interface', 'WIFI-0004', 'BUS-0002', { by: P.ines })

// ─── Exécutions de tests hors campagne (test-runs/) ──────────────────────────

const stepsRes = (...r) => r.map((result, i) => ({ order: i + 1, result, comment: '' }))

export const ADHOC_RUNS = [
  { phase: 'P5', repo: 'produit', testId: 'THYD-0001', result: 'PASS', by: P.sophie, at: '2026-05-12T10:00:00.000Z', duration: 900, stepResults: stepsRes('PASS', 'PASS'), notes: 'Banc B2, pression stabilisée à 1,2 MPa.' },
  { phase: 'P5', repo: 'produit', testId: 'THYD-0002', result: 'PASS', by: P.sophie, at: '2026-05-12T14:00:00.000Z', duration: 600, stepResults: stepsRes('PASS'), notes: 'Débit mesuré : 9,1 L/min.' },
  { phase: 'P5', repo: 'produit', testId: 'TSW-0002', result: 'PASS', by: P.ines, at: '2026-05-13T09:00:00.000Z', duration: 120, stepResults: stepsRes('PASS'), notes: 'Reset observé à 64 ms.' },
  { phase: 'P5', repo: 'produit', testId: 'TSW-0003', result: 'FAIL', by: P.ines, at: '2026-05-13T11:00:00.000Z', duration: 300,
    stepResults: [{ order: 1, result: 'FAIL', comment: 'La touche **Départ** reste active malgré la sécurité enfant.' }, { order: 2, result: 'PASS', comment: '' }],
    notes: 'Anomalie remontée (ticket firmware FW-311).' },
  { phase: 'P7', repo: 'produit', testId: 'TSW-0003', result: 'PASS', by: P.ines, at: '2026-07-06T11:00:00.000Z', duration: 280, stepResults: stepsRes('PASS', 'PASS'), notes: 'Corrigé en firmware 1.3.0.' },
  { phase: 'P5', repo: 'moteur', testId: 'TMOT-0001', result: 'PASS', by: P.yann, at: '2026-05-06T09:30:00.000Z', duration: 1800, stepResults: stepsRes('PASS'),
    equipmentUsed: [{ equipmentId: 'banc-dyn-01', role: 'Banc dynamométrique', identification: 'BD-01', calibrationDate: '2026-01-15', notes: null }], notes: '' },
  { phase: 'P5', repo: 'moteur', testId: 'TMOT-0002', result: 'PASS', by: P.yann, at: '2026-05-07T09:30:00.000Z', duration: 3600, stepResults: stepsRes('PASS'), notes: '' },
  { phase: 'P5', repo: 'pompe', testId: 'TPOMP-0001', result: 'PASS', by: P.sophie, at: '2026-05-05T10:00:00.000Z', duration: 600, stepResults: stepsRes('PASS'), notes: 'Débit : 23,4 L/min.' },
  { phase: 'P5', repo: 'pompe', testId: 'TPOMP-0002', result: 'PASS', by: P.sophie, at: '2026-05-05T15:00:00.000Z', duration: 900, stepResults: stepsRes('PASS'), notes: '' },
]

// ─── Campagnes (repo produit) ────────────────────────────────────────────────
// entries : [testId, { status, requirementId?, paramValues?, resolvedParams?, unresolvedParams?, run? }]
// run : { result, by, at, duration, stepResults, notes } — le fichier de run est écrit dans le repo du test.

export const CAMPAIGNS = [
  {
    phase: 'P5', id: 'CAMP-0001', title: 'EVT — Essais de validation technique', status: 'completed',
    fields: { jalon: 'EVT', lieu: 'Laboratoire essais Lyon', description: 'Première campagne sur prototypes **EVT** (10 machines).' },
    baselineRef: 'RE1', createdAt: '2026-05-04T08:00:00.000Z', completedAt: '2026-05-19T17:00:00.000Z',
    entries: [
      ['TSYS-0001', { resolvedParams: { capacite_kg: '8 kg' }, run: { result: 'PASS', by: P.marc, at: '2026-05-05T09:00:00.000Z', duration: 1800, stepResults: stepsRes('PASS', 'PASS', 'PASS'), notes: 'Masse mesurée 8,03 kg.' } }],
      ['TSYS-0002', { resolvedParams: { capacite_kg: '8 kg', vitesse_essorage: '1200 tr/min', 'comp-moteur::vitesse_essorage_max': '1200 tr/min' },
        run: { result: 'PASS', by: P.marc, at: '2026-05-06T10:00:00.000Z', duration: 1200, stepResults: stepsRes('PASS', 'PASS'), notes: 'Vitesse max relevée : 1196 tr/min.' } }],
      ['TSYS-0003', { paramValues: { charge_essai: '8 kg' }, resolvedParams: { consommation_eau_eco: '45 L', duree_programme_eco: '225 min' },
        run: { result: 'PASS', by: P.marc, at: '2026-05-08T08:00:00.000Z', duration: 14400, stepResults: stepsRes('PASS', 'PASS', 'PASS'), notes: 'Moyenne 3 cycles : 43,8 L — 3 h 38.' } }],
      ['TSYS-0004', { resolvedParams: { niveau_sonore_essorage: '74 dB(A)' },
        run: { result: 'FAIL', by: P.marc, at: '2026-05-11T14:00:00.000Z', duration: 3600,
          stepResults: [{ order: 1, result: 'PASS', comment: '' }, { order: 2, result: 'FAIL', comment: 'L_WA mesuré : **76,2 dB(A)** — résonance du panneau arrière.' }],
          notes: 'Action : ajout d\'un raidisseur sur le panneau arrière.' } }],
      ['TSYS-0007', { run: { result: 'BLOCKED', by: P.marc, at: '2026-05-12T09:00:00.000Z', duration: 0,
        stepResults: [{ order: 1, result: 'BLOCKED', comment: 'Banc hydraulique en maintenance.' }, { order: 2, result: 'NOT_EXECUTED', comment: '' }, { order: 3, result: 'NOT_EXECUTED', comment: '' }],
        notes: 'Banc indisponible jusqu\'à fin mai.' } }],
      ['TMOT-0003', { resolvedParams: { courant_max: '8 A' }, run: { result: 'FAIL', by: P.yann, at: '2026-05-14T10:00:00.000Z', duration: 600,
        stepResults: [{ order: 1, result: 'FAIL', comment: 'Coupure mesurée à 14 µs.' }], notes: 'Test d\'un composant (repo comp-moteur) exécuté dans une campagne produit.' } }],
      ['TSW-0001', { run: { result: 'PASS', by: P.ines, at: '2026-05-15T10:00:00.000Z', duration: 900, stepResults: stepsRes('PASS', 'PASS'), notes: '' } }],
    ],
  },
  {
    phase: 'P7', id: 'CAMP-0002', title: 'DVT — Essais de vérification design', status: 'in_progress',
    fields: { jalon: 'DVT', lieu: 'Laboratoire essais Lyon' }, baselineRef: 'RE2', createdAt: '2026-07-01T08:00:00.000Z',
    entries: [
      ['TSYS-0002', { resolvedParams: { capacite_kg: '8 kg', vitesse_essorage: '1400 tr/min', 'comp-moteur::vitesse_essorage_max': '1400 tr/min' },
        run: { result: 'PASS', by: P.marc, at: '2026-07-02T10:00:00.000Z', duration: 1200, stepResults: stepsRes('PASS', 'PASS'), notes: 'Vitesse max relevée : 1392 tr/min.' } }],
      ['TSYS-0004', { resolvedParams: { niveau_sonore_essorage: '74 dB(A)' },
        run: { result: 'PASS', by: P.marc, at: '2026-07-03T14:00:00.000Z', duration: 3600, stepResults: stepsRes('PASS', 'PASS'), notes: 'L_WA = 73,1 dB(A) avec raidisseur.' } }],
      ['TSYS-0006', { run: { result: 'PASS', by: P.marc, at: '2026-07-04T09:00:00.000Z', duration: 2700, stepResults: stepsRes('PASS', 'PASS', 'PASS'), notes: '' } }],
      ['TSYS-0007', { run: { result: 'INCOMPLETE', by: P.marc, at: '2026-07-06T09:00:00.000Z', duration: 2400,
        stepResults: [{ order: 1, result: 'PASS', comment: '' }, { order: 2, result: 'PASS', comment: '' }, { order: 3, result: 'NOT_EXECUTED', comment: 'Interrompu à 6/10 répétitions.' }], notes: '' } }],
      ['TSYS-0008', {}],
      ['TSYS-0010', {}],
      ['TSYS-0011', { unresolvedParams: [{ ref: 'comp-inexistant::ref_pompe', reason: 'unknown_node' }, { ref: 'comp-pompe-vidange::bruit_max', reason: 'empty' }] }],
    ],
  },
  {
    phase: 'P7', id: 'CAMP-0003', title: 'Vérification des KPI produit', status: 'in_progress',
    fields: { jalon: 'DVT', description: 'Campagne générée depuis le test itérant **TSYS-0005** : une instance par exigence liée.' },
    createdAt: '2026-07-07T08:00:00.000Z',
    reqInstances: true,
    entries: [
      ['TSYS-0005', { requirementId: 'PRD-0001', resolvedParams: { 'req.id': 'PRD-0001', 'req.title': 'Capacité de charge', 'req.kpi_cible': '8 kg' },
        run: { result: 'PASS', by: P.marc, at: '2026-07-07T10:00:00.000Z', duration: 600, stepResults: stepsRes('PASS', 'PASS'), notes: '8,03 kg.' } }],
      ['TSYS-0005', { requirementId: 'PRD-0002', resolvedParams: { 'req.id': 'PRD-0002', 'req.title': "Vitesse d'essorage maximale", 'req.kpi_cible': '1400 tr/min' },
        run: { result: 'FAIL', by: P.marc, at: '2026-07-07T11:00:00.000Z', duration: 600,
          stepResults: [{ order: 1, result: 'FAIL', comment: '1352 tr/min mesurés sur la machine n°4.' }, { order: 2, result: 'PASS', comment: '' }], notes: '' } }],
      ['TSYS-0005', { requirementId: 'PRD-0003', resolvedParams: { 'req.id': 'PRD-0003', 'req.title': "Consommation d'eau du programme Eco 40-60", 'req.kpi_cible': '≤ 45 L' } }],
      ['TSYS-0005', { requirementId: 'PRD-0004', resolvedParams: { 'req.id': 'PRD-0004', 'req.title': 'Niveau sonore en essorage', 'req.kpi_cible': '≤ 74 dB(A)' } }],
      ['TSYS-0005', { requirementId: 'PRD-0005', resolvedParams: { 'req.id': 'PRD-0005', 'req.title': 'Durée du programme Eco 40-60', 'req.kpi_cible': '≤ 3 h 45' } }],
      ['TSYS-0005', { requirementId: 'SYS-0009', resolvedParams: { 'req.id': 'SYS-0009', 'req.title': 'Consommation en veille' },
        unresolvedParams: [{ ref: 'req.kpi_cible', reason: 'missing' }] }],
    ],
  },
  {
    phase: 'P7', id: 'CAMP-0004', title: 'Endurance 5000 cycles', status: 'abandoned',
    fields: { jalon: 'DVT', lieu: 'Sous-traitant', description: 'Abandonnée : reportée au jalon PVT (budget).' },
    createdAt: '2026-06-20T08:00:00.000Z', completedAt: '2026-07-08T09:00:00.000Z',
    entries: [['TSYS-0008', {}]],
  },
  {
    phase: 'P8', id: 'CAMP-0005', title: 'PVT — Présérie', status: 'planned',
    fields: { jalon: 'PVT', lieu: 'Usine' }, createdAt: '2026-07-20T08:00:00.000Z',
    entries: [['TSYS-0001', { resolvedParams: { capacite_kg: '8 kg' } }], ['TSYS-0009', { resolvedParams: { puissance_veille_max: '0.5 W' } }], ['TSYS-0003', { paramValues: { charge_essai: '' }, resolvedParams: { consommation_eau_eco: '45 L', duree_programme_eco: '225 min' } }]],
  },
]

// ─── Reviews (repo produit) ──────────────────────────────────────────────────

export const REVIEWS = [
  {
    phase: 'P4', id: 'REVIEW-0001', title: "Revue d'étude RE1 — exigences produit", status: 'approved',
    description: 'Revue formelle des exigences produit de performance avant le gel **RE1**.',
    createdBy: P.claire.name, createdAt: '2026-04-20T08:00:00.000Z', dueDate: '2026-04-24', quorum: 2,
    reviewers: [P.claire.name, P.hugo.name, P.marc.name],
    objects: ['PRD-0001', 'PRD-0002', 'PRD-0003', 'PRD-0004', 'PRD-0005'].map(id => ({
      objectId: id, objectType: 'requirement', objectVersion: 1,
      approvals: [P.hugo, P.marc].map(p => ({ reviewerId: p.name, approvedAt: '2026-04-23T15:00:00.000Z', objectId: id })),
      approvalStatus: 'quorum_reached',
    })),
  },
  {
    phase: 'P5', id: 'REVIEW-0002', title: 'Revue IHM — maquettes façade', status: 'closed',
    description: 'Revue close sans approbation : maquettes à reprendre après le retour UX.',
    createdBy: P.ines.name, createdAt: '2026-05-02T08:00:00.000Z', dueDate: null, quorum: null,
    reviewers: [P.ines.name, P.claire.name],
    objects: [{ objectId: 'IHM-0001', objectType: 'requirement', objectVersion: 1, approvals: [] }],
  },
  {
    phase: 'P7', id: 'REVIEW-0003', title: 'Revue des évolutions post-EVT', status: 'open',
    description: 'Évolutions issues de la campagne EVT : essorage, remontée d\'état Wi-Fi, entretien du filtre.',
    createdBy: P.hugo.name, createdAt: '2026-07-08T08:00:00.000Z', dueDate: '2026-07-31', quorum: null,
    reviewers: [P.hugo.name, P.ines.name, P.marc.name],
    objects: [
      { objectId: 'SYS-0002', objectType: 'requirement', objectVersion: 2, approvals: [{ reviewerId: P.ines.name, approvedAt: '2026-07-09T10:00:00.000Z', objectId: 'SYS-0002' }] },
      { objectId: 'SYS-0013', objectType: 'requirement', objectVersion: 1, approvals: [] },
      { objectId: 'PRD-0012', objectType: 'requirement', objectVersion: 1, approvals: [] },
      { objectId: 'TSYS-0011', objectType: 'test_case', objectVersion: 1, approvals: [] },
    ],
  },
]

// ─── Requêtes & dashboards partagés (repo produit) ───────────────────────────

export const QUERIES = [
  { id: 'QUERY-0001', title: 'Exigences — statut par composant', mode: 'sql',
    sqlText: 'SELECT [component], [status], COUNT(*) AS [count] FROM [requirements] GROUP BY [component], [status]' },
  { id: 'QUERY-0002', title: 'Exigences — statut de couverture', mode: 'sql',
    sqlText: 'SELECT [coverageStatus], COUNT(*) AS [count] FROM [requirements] GROUP BY [coverageStatus]' },
  { id: 'QUERY-0003', title: 'Exigences produit prioritaires non approuvées', mode: 'builder',
    builderConfig: { objectTypeRef: 'root::exigence-produit', conditions: [{ field: 'priority', operator: '=', value: 'high' }, { field: 'status', operator: '!=', value: 'approved' }], combinator: 'AND' } },
  { id: 'QUERY-0004', title: 'Tests — résultat de la dernière exécution', mode: 'sql',
    sqlText: 'SELECT [latestRunResult], COUNT(*) AS [count] FROM [tests] GROUP BY [latestRunResult]' },
  { id: 'QUERY-0005', title: 'Exigences à revalider', mode: 'sql',
    sqlText: 'SELECT COUNT(*) AS [count] FROM [requirements] WHERE [needsRevalidation] = true' },
  { id: 'QUERY-0006', title: 'Exigences de sécurité', mode: 'sql',
    sqlText: 'SELECT [id], [title], [status], [coverageStatus], [component] FROM [requirements] WHERE [securite] = true ORDER BY [id]' },
  { id: 'QUERY-0007', title: 'Liens par type', mode: 'sql',
    sqlText: 'SELECT [type], COUNT(*) AS [count] FROM [links] GROUP BY [type]' },
  { id: 'QUERY-0008', title: 'Exigences moteur par statut (builder, composant)', mode: 'builder',
    builderConfig: { objectTypeRef: 'root::exigence-moteur', component: 'comp-moteur', conditions: [], combinator: 'AND', groupBy: ['status'] } },
  { id: 'QUERY-0009', title: 'Exigences par version', mode: 'sql',
    sqlText: 'SELECT [version], COUNT(*) AS [count] FROM [requirements] GROUP BY [version] ORDER BY [version]' },
]

export const DASHBOARDS = [
  {
    id: 'DASHBOARD-0001', title: 'Pilotage LL800', createdAt: '2026-04-24T15:00:00.000Z', by: P.hugo,
    widgets: [
      { key: 'statut', title: 'Statut des exigences par composant', queryId: 'QUERY-0001', type: 'bar', fieldMapping: { category: 'component', measure: 'count', series: 'status', stacked: true }, size: 'lg' },
      { key: 'couverture', title: 'Couverture des exigences', queryId: 'QUERY-0002', type: 'pie', fieldMapping: { category: 'coverageStatus', measure: 'count' }, size: 'md' },
      { key: 'revalider', title: 'À revalider', queryId: 'QUERY-0005', type: 'kpi', fieldMapping: { measure: 'count' }, size: 'sm' },
      { key: 'runs', title: 'Dernière exécution des tests', queryId: 'QUERY-0004', type: 'bar', fieldMapping: { category: 'latestRunResult', measure: 'count' }, size: 'md' },
      { key: 'securite', title: 'Exigences de sécurité', queryId: 'QUERY-0006', type: 'table', fieldMapping: { columns: ['id', 'title', 'status', 'coverageStatus', 'component'] }, size: 'lg' },
      { key: 'versions', title: 'Exigences par version', queryId: 'QUERY-0009', type: 'line', fieldMapping: { category: 'version', measure: 'count' }, size: 'md' },
    ],
  },
  {
    id: 'DASHBOARD-0002', title: 'Composants & traçabilité', createdAt: '2026-04-24T15:30:00.000Z', by: P.marc,
    widgets: [
      { key: 'liens', title: 'Liens par type', queryId: 'QUERY-0007', type: 'pie', fieldMapping: { category: 'type', measure: 'count' }, size: 'md' },
      { key: 'moteur', title: 'Exigences moteur par statut', queryId: 'QUERY-0008', type: 'bar', fieldMapping: { category: 'status', measure: 'count' }, size: 'md' },
      { key: 'prio', title: 'Prioritaires non approuvées', queryId: 'QUERY-0003', type: 'table', fieldMapping: { columns: ['id', 'title', 'status', 'priority'] }, size: 'lg' },
    ],
  },
]
