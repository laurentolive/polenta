// Schémas (.polenta/schema.yaml) des 5 repos du workspace de démonstration.
// Chaque repo est autonome (son propre schéma) ; le repo produit porte en plus des composants
// locaux imbriqués et des interfaces locales.

const STATUSES_REQ = [
  { name: 'draft', label: 'Brouillon', color: '#475569' },
  { name: 'review', label: 'En review', color: '#b45309' },
  { name: 'approved', label: 'Approuvé', color: '#16a34a', isApproval: true },
  { name: 'obsolete', label: 'Obsolète', color: '#6b7280', isTerminal: true },
]

const STATUSES_REQ_WITH_REJECT = [
  STATUSES_REQ[0],
  STATUSES_REQ[1],
  STATUSES_REQ[2],
  { name: 'rejected', label: 'Rejetée', color: '#dc2626', isTerminal: true },
  STATUSES_REQ[3],
]

const STATUSES_TEST = [
  { name: 'draft', label: 'Brouillon', color: '#475569' },
  { name: 'review', label: 'En review', color: '#b45309' },
  { name: 'approved', label: 'Approuvé', color: '#16a34a', isApproval: true },
  { name: 'obsolete', label: 'Obsolète', color: '#6b7280', isTerminal: true },
]

const F = {
  statement: { name: 'statement', label: 'Énoncé (EARS)', type: 'richtext', validator: 'EARS', required: true },
  priority: { name: 'priority', label: 'Priorité', type: 'enum', values: ['high', 'medium', 'low'], required: true, default: 'medium' },
  acceptance: { name: 'acceptanceCriteria', label: "Critères d'acceptance", type: 'richtext' },
  rationale: { name: 'rationale', label: 'Justification', type: 'richtext' },
  securite: { name: 'securite', label: 'Exigence de sécurité', type: 'boolean', default: false },
}

const LINK_TYPES_BASE = [
  {
    name: 'implementation',
    labelSourceToTarget: 'est implémentée par',
    labelTargetToSource: 'implémente',
    sourceRefs: ['requirement'],
    targetRefs: ['requirement'],
  },
  {
    name: 'verification',
    labelSourceToTarget: 'vérifie',
    labelTargetToSource: 'est vérifiée par',
    sourceRefs: ['test'],
    targetRefs: ['requirement'],
  },
  {
    name: 'implements-interface',
    labelSourceToTarget: "implémente l'exigence d'interface",
    labelTargetToSource: 'est implémentée (interface) par',
    sourceRefs: ['requirement'],
    targetRefs: ['requirement'],
  },
]

// ─── Repo produit ────────────────────────────────────────────────────────────

export const schemaProduit = {
  version: 1,
  preferences: { autoPropagatePin: false },
  nodes: [
    {
      name: 'root',
      label: 'Lave-linge LL800',
      description: 'Lave-linge frontal 8 kg, 1400 tr/min — repo produit (source de vérité de la traçabilité).',
      readonly: false,
      objectTypes: [
        {
          name: 'exigence-produit',
          label: 'Exigence Produit',
          color: '#7c3aed',
          prefix: 'PRD',
          category: 'requirement',
          fields: [
            F.statement,
            F.priority,
            { name: 'source', label: 'Source', type: 'enum', values: ['Marketing', 'Normes', 'Retour terrain', 'Réglementation'] },
            { name: 'marches', label: 'Marchés', type: 'multi_enum', values: ['EU', 'US', 'CN', 'JP'] },
            { name: 'claim', label: 'Argument marketing (claim)', type: 'boolean', default: false },
            { name: 'kpi_cible', label: 'KPI cible', type: 'text', placeholder: 'ex. ≤ 45 L' },
            { name: 'echeance', label: 'Échéance', type: 'date' },
            { name: 'responsable', label: 'Responsable', type: 'user' },
            { name: 'reference_client', label: 'Réf. demande client', type: 'text', validator: 'regex:^CLI-[0-9]{4}$', placeholder: 'CLI-0000' },
            F.rationale,
            F.acceptance,
          ],
          statuses: STATUSES_REQ_WITH_REJECT,
        },
        {
          name: 'exigence-systeme',
          label: 'Exigence Système',
          color: '#2563eb',
          prefix: 'SYS',
          category: 'requirement',
          fields: [
            F.statement,
            F.priority,
            F.securite,
            { name: 'domaine', label: 'Domaine', type: 'enum', values: ['SW', 'HW', 'MECA', 'HYDRAU', 'THERMIQUE'] },
            F.acceptance,
            { name: 'diagramme', label: 'Diagramme de référence', type: 'drawio' },
            { name: 'notes', label: 'Notes internes', type: 'textarea' },
            { name: 'derniere_revue', label: 'Dernière revue', type: 'datetime' },
          ],
          statuses: STATUSES_REQ,
        },
        {
          name: 'test-systeme',
          label: 'Test Système',
          color: '#0891b2',
          prefix: 'TSYS',
          category: 'test',
          fields: [
            { name: 'niveau', label: 'Niveau', type: 'enum', values: ['unitaire', 'intégration', 'système', 'endurance'], required: true },
            { name: 'duree_min', label: 'Durée estimée (min)', type: 'number' },
            { name: 'destructif', label: 'Test destructif', type: 'boolean', default: false },
            { name: 'moyens', label: "Moyens d'essai", type: 'multi_enum', values: ['Banc hydraulique', 'Chambre climatique', 'Balance', 'Wattmètre', 'Sonomètre', 'Tachymètre'] },
          ],
          statuses: STATUSES_TEST,
        },
        {
          name: 'campagne-produit',
          label: 'Campagne Produit',
          prefix: 'CAMP',
          category: 'campaign',
          fields: [
            { name: 'jalon', label: 'Jalon', type: 'enum', values: ['EVT', 'DVT', 'PVT'] },
            { name: 'lieu', label: "Lieu d'essai", type: 'text' },
            { name: 'description', label: 'Description', type: 'richtext' },
          ],
        },
      ],
      children: [
        {
          name: 'hydraulique',
          label: 'Sous-système hydraulique',
          description: 'Composant local — arrivée d\'eau, cuve, capteur de niveau. Héberge la pompe de vidange (repo séparé, localParent).',
          readonly: false,
          objectTypes: [
            {
              name: 'exigence-hydraulique',
              label: 'Exigence Hydraulique',
              prefix: 'HYD',
              category: 'requirement',
              fields: [F.statement, F.priority, { name: 'debit_l_min', label: 'Débit (L/min)', type: 'number' }, F.acceptance],
              statuses: STATUSES_REQ,
            },
            {
              name: 'test-hydraulique',
              label: 'Test Hydraulique',
              prefix: 'THYD',
              category: 'test',
              fields: [{ name: 'banc', label: 'Banc', type: 'text' }],
              statuses: STATUSES_TEST,
            },
          ],
          children: [
            {
              name: 'electrovannes',
              label: 'Électrovannes',
              description: 'Composant local de 3e niveau (produit › hydraulique › électrovannes).',
              readonly: false,
              objectTypes: [
                {
                  name: 'exigence-electrovanne',
                  label: 'Exigence Électrovanne',
                  prefix: 'EV',
                  category: 'requirement',
                  fields: [F.statement, F.priority, F.securite],
                  statuses: STATUSES_REQ,
                },
              ],
            },
          ],
        },
        {
          name: 'carte-commande',
          label: 'Carte de commande',
          description: 'Carte électronique maîtresse : contrôleur du bus interne (repo interface) et maître du bus IHM (interface locale).',
          readonly: false,
          objectTypes: [
            {
              name: 'exigence-carte',
              label: 'Exigence Carte',
              prefix: 'CC',
              category: 'requirement',
              fields: [F.statement, F.priority, F.securite, { name: 'composant_ref', label: 'Référence composant', type: 'text' }],
              statuses: STATUSES_REQ,
            },
          ],
          implements: [
            { interface: 'if-bus-interne', roles: ['controller'] },
            { interface: 'bus-ihm', roles: ['maitre'] },
          ],
          children: [
            {
              name: 'logiciel',
              label: 'Logiciel de commande',
              readonly: false,
              objectTypes: [
                {
                  name: 'exigence-logiciel',
                  label: 'Exigence Logiciel',
                  prefix: 'SW',
                  category: 'requirement',
                  fields: [
                    F.statement,
                    F.priority,
                    F.securite,
                    { name: 'module', label: 'Module', type: 'enum', values: ['FSM', 'Sécurité', 'IHM', 'Communication', 'Diagnostic'] },
                    { name: 'classe_logicielle', label: 'Classe logicielle (IEC 60730)', type: 'enum', values: ['A', 'B', 'C'] },
                  ],
                  statuses: STATUSES_REQ,
                },
                {
                  name: 'test-logiciel',
                  label: 'Test Logiciel',
                  prefix: 'TSW',
                  category: 'test',
                  fields: [
                    { name: 'automatise', label: 'Automatisé', type: 'boolean', default: false },
                    { name: 'version_firmware', label: 'Version firmware', type: 'text', validator: 'regex:^[0-9]+\\.[0-9]+\\.[0-9]+$' },
                  ],
                  statuses: STATUSES_TEST,
                },
              ],
            },
          ],
        },
        {
          name: 'bus-ihm',
          label: 'Bus IHM (interface locale)',
          description: 'Interface portée par un composant local : rôles maître/esclave, implémentée par la carte de commande et l\'IHM.',
          readonly: false,
          roles: [
            { name: 'maitre', label: 'Maître' },
            { name: 'esclave', label: 'Esclave' },
          ],
          objectTypes: [
            {
              name: 'exigence-bus-ihm',
              label: 'Exigence Bus IHM',
              prefix: 'BIHM',
              category: 'requirement',
              fields: [F.statement, { name: 'roles', label: 'Rôles concernés', type: 'multi_enum', values: ['maitre', 'esclave'] }],
              statuses: STATUSES_REQ,
            },
          ],
        },
        {
          name: 'ihm',
          label: 'IHM façade',
          readonly: false,
          objectTypes: [
            {
              name: 'exigence-ihm',
              label: 'Exigence IHM',
              prefix: 'IHM',
              category: 'requirement',
              fields: [F.statement, F.priority, { name: 'maquette', label: 'Maquette', type: 'richtext' }],
              statuses: STATUSES_REQ,
            },
          ],
          implements: [{ interface: 'bus-ihm', roles: ['esclave'] }],
        },
      ],
    },
  ],
  linkTypes: [
    {
      name: 'raffinement',
      labelSourceToTarget: 'est raffinée par',
      labelTargetToSource: 'raffine',
      sourceRefs: ['root::exigence-produit'],
      targetRefs: ['requirement'],
    },
    ...LINK_TYPES_BASE,
    {
      name: 'relation',
      labelSourceToTarget: 'est en relation avec',
      labelTargetToSource: 'est en relation avec',
    },
  ],
}

// ─── Repos composants ────────────────────────────────────────────────────────

export const schemaMoteur = {
  version: 1,
  nodes: [
    {
      name: 'root',
      label: 'Moteur BLDC & onduleur',
      description: 'Composant réutilisable : moteur à entraînement direct et son onduleur.',
      readonly: false,
      objectTypes: [
        {
          name: 'exigence-moteur',
          label: 'Exigence Moteur',
          prefix: 'MOT',
          category: 'requirement',
          fields: [F.statement, F.priority, F.securite, { name: 'couple_nm', label: 'Couple (N·m)', type: 'number' }, F.acceptance],
          statuses: STATUSES_REQ,
        },
        {
          name: 'test-moteur',
          label: 'Test Moteur',
          prefix: 'TMOT',
          category: 'test',
          fields: [{ name: 'banc', label: 'Banc moteur', type: 'enum', values: ['Banc dynamométrique', 'Banc thermique', 'Banc HIL'] }],
          statuses: STATUSES_TEST,
        },
      ],
      children: [
        {
          name: 'firmware-moteur',
          label: 'Firmware FOC',
          readonly: false,
          objectTypes: [
            {
              name: 'exigence-fw-moteur',
              label: 'Exigence Firmware moteur',
              prefix: 'FWM',
              category: 'requirement',
              fields: [F.statement, F.priority, F.securite],
              statuses: STATUSES_REQ,
            },
          ],
        },
      ],
      implements: [{ interface: 'if-bus-interne', roles: ['device'] }],
    },
  ],
  implements: [{ interface: 'if-bus-interne', roles: ['device'] }],
  linkTypes: LINK_TYPES_BASE,
}

export const schemaPompe = {
  version: 1,
  nodes: [
    {
      name: 'root',
      label: 'Pompe de vidange',
      readonly: false,
      objectTypes: [
        {
          name: 'exigence-pompe',
          label: 'Exigence Pompe',
          prefix: 'POMP',
          category: 'requirement',
          fields: [F.statement, F.priority, F.securite, F.acceptance],
          statuses: STATUSES_REQ,
        },
        {
          name: 'test-pompe',
          label: 'Test Pompe',
          prefix: 'TPOMP',
          category: 'test',
          fields: [],
          statuses: STATUSES_TEST,
        },
      ],
    },
  ],
  linkTypes: LINK_TYPES_BASE,
}

export const schemaWifi = {
  version: 1,
  nodes: [
    {
      name: 'root',
      label: 'Module Wi-Fi',
      readonly: false,
      objectTypes: [
        {
          name: 'exigence-wifi',
          label: 'Exigence Wi-Fi',
          prefix: 'WIFI',
          category: 'requirement',
          fields: [F.statement, F.priority, { name: 'bande', label: 'Bande', type: 'enum', values: ['2.4 GHz', '5 GHz', 'bi-bande'] }],
          statuses: STATUSES_REQ,
        },
      ],
      implements: [{ interface: 'if-bus-interne', roles: ['device'] }],
    },
  ],
  implements: [{ interface: 'if-bus-interne', roles: ['device'] }],
  linkTypes: LINK_TYPES_BASE,
}

const BUS_ROLES = [
  { name: 'controller', label: 'Contrôleur' },
  { name: 'device', label: 'Périphérique' },
]

export const schemaBus = {
  version: 1,
  nodes: [
    {
      name: 'root',
      label: 'Bus interne (interface)',
      description: 'Repo interface : spécifie le bus série entre la carte de commande et les périphériques.',
      readonly: false,
      roles: BUS_ROLES,
      objectTypes: [
        {
          name: 'exigence-bus',
          label: 'Exigence Bus',
          prefix: 'BUS',
          category: 'requirement',
          fields: [
            F.statement,
            { name: 'roles', label: 'Rôles concernés', type: 'multi_enum', values: ['controller', 'device'] },
            { name: 'version_protocole', label: 'Version protocole', type: 'text' },
          ],
          statuses: STATUSES_REQ,
        },
      ],
    },
  ],
  roles: BUS_ROLES,
  linkTypes: LINK_TYPES_BASE,
}
