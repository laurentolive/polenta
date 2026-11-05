// GH278 — versions, issues et validations de la démo : étapes datées, jouées par les services de
// l'application après le commit de leur phase (cf. app-services.ts). L'histoire :
//   P5  les essais EVT échouent → issues ouvertes depuis les runs
//   P6  version 1.0 du produit et des composants, released et signée ; la 2.0 s'ouvre
//   P7  la DVT s'exécute sur la 2.0 ; un correctif 1.1 s'ouvre ; validation de la 2.0 commencée
//   P8  le correctif 1.1 est abandonné ; moteur 1.3 ouverte ; pompe 2.0 released
import { P } from './content.mjs'

const release = async (ctx, title, tag, { basedOn, components, description, include }) => {
  const v = await ctx.app.versions.create(ctx.dir, { title, ...(basedOn !== undefined && { basedOn }), components, fields: { description } }, ctx.ws)
  await ctx.app.versions.include(ctx.dir, v.id, include ?? ctx.elements(), ctx.ws)
  ctx.commit(`Version ${title} : contenu`)
  return ctx.app.versions.release(ctx.dir, v.id, tag, ctx.ws)
}

/** Décide chaque exigence de la validation : `conforme` sauf exceptions. */
const decideAll = async (ctx, validationId, exceptions = {}) => {
  const page = await ctx.app.validations.page(ctx.dir, validationId, ctx.ws)
  for (const row of page.rows) {
    const [decision, comment] = exceptions[row.requirementId] ?? ['conforme']
    await ctx.app.validations.decide(ctx.dir, validationId, { requirementId: row.requirementId, decision, ...(comment && { comment }) }, ctx.ws)
  }
}

const issue = async (ctx, title, status, fields, origin, impacts) => {
  const created = await ctx.app.issues.create(ctx.dir, { objectTypeRef: 'root::issue', title, status, fields, origin }, ctx.ws)
  for (const id of impacts) ctx.link('issue-impact', created.id, id)
  return created
}

// Le bus est monté sous le moteur dans l'arbre du workspace : il suit la version du moteur.
export const COMPONENTS_1_0 = { 'comp-moteur': 'MOTV-0001', 'comp-pompe-vidange': 'POMV-0001', 'comp-module-wifi': 'WIFV-0001' }
const PIN_TAGS = { bus: 'v1.1' }

export const STEPS = {
  P5: {
    moteur: [{
      at: '2026-05-16T09:00:00+02:00', by: P.yann, msg: 'Issue : temps de coupure onduleur',
      run: ctx => issue(ctx, "Temps de coupure de l'onduleur trop long", 'ouverte',
        { gravite: 'majeure', description: 'Coupure à 14 µs mesurée par **TMOT-0003**, limite à 10 µs.' },
        { runs: [ctx.runId('TMOT-0003', 'CMOT-0001')] }, ['MOT-0004']),
    }],
    produit: [{
      at: '2026-05-20T14:00:00+02:00', by: P.marc, msg: 'Issue : niveau sonore en essorage',
      run: ctx => issue(ctx, 'Résonance du panneau arrière en essorage', 'ouverte',
        { gravite: 'majeure', description: 'L_WA de 76,2 dB(A) relevé par **TSYS-0004** en EVT, limite à 74 dB(A).' },
        { runs: [ctx.runId('TSYS-0004', 'CAMP-0001')] }, ['PRD-0004']),
    }],
  },
  P6: {
    bus: [{
      at: '2026-06-16T09:00:00+02:00', by: P.ines, msg: 'Version 1.1 du protocole',
      run: ctx => release(ctx, '1.1', PIN_TAGS.bus, { description: 'Protocole v1.1 : délai de réponse ramené à 10 ms.' }),
    }],
    wifi: [{
      at: '2026-06-16T10:00:00+02:00', by: P.ines, msg: 'Version 1.0 du module Wi-Fi',
      run: ctx => release(ctx, '1.0', 'comp-module-wifi-1.0', { description: 'Première version du module.' }),
    }],
    pompe: [{
      at: '2026-06-16T11:00:00+02:00', by: P.sophie, msg: 'Version 1.0 de la pompe',
      run: ctx => release(ctx, '1.0', 'comp-pompe-vidange-1.0', { description: 'Première version de la pompe.' }),
    }],
    moteur: [{
      at: '2026-06-17T09:00:00+02:00', by: P.yann, msg: 'Version 1.2.4 du moteur, validation signée', tree: 'moteur',
      run: async ctx => {
        await release(ctx, '1.2.4', 'comp-moteur-1.2.4', { components: { 'if-bus-interne': 'IFV-0001' }, description: 'Essorage 1400 tr/min.' })
        ctx.commit('Version 1.2.4 du moteur')
        const val = await ctx.app.validations.create(ctx.dir, { title: 'Validation 1.2.4', versionId: 'MOTV-0001' }, ctx.ws)
        await decideAll(ctx, val.id, {
          'MOT-0004': ['derogation', 'Coupure à 14 µs acceptée pour la présérie, correction prévue en 1.3.'],
          'MOT-0007': ['hors_scope', 'Rendement mesuré en 1.3.'],
        })
        ctx.commit('Décisions de la validation 1.2.4')
        await ctx.app.validations.sign(ctx.dir, val.id, ctx.ws)
      },
    }],
    produit: [{
      at: '2026-06-22T09:00:00+02:00', by: P.claire, msg: 'Version 1.0 du lave-linge', tree: 'produit',
      run: async ctx => {
        await ctx.app.issues.update(ctx.dir, 'ISS-0001', { status: 'corrigee' }, ctx.ws)
        ctx.commit('ISS-0001 corrigée par le raidisseur')
        await release(ctx, '1.0', 'll800-produit-1.0', {
          components: COMPONENTS_1_0, description: 'Première version livrée à la présérie.', include: [...ctx.elements(), 'ISS-0001'],
        })
      },
    }, {
      at: '2026-06-24T15:00:00+02:00', by: P.marc, msg: 'Validation 1.0 signée', tree: 'produit',
      run: async ctx => {
        const val = await ctx.app.validations.create(ctx.dir, { title: 'Validation 1.0', versionId: 'LLV-0001' }, ctx.ws)
        await decideAll(ctx, val.id, {
          'PRD-0010': ['hors_scope', "Le pilotage à distance n'est pas livré en 1.0."],
          'SYS-0013': ['hors_scope', "Remontée d'état Wi-Fi prévue en 2.0."],
          'SYS-0004': ['derogation', 'Couverture partielle acceptée, endurance reportée.'],
        })
        ctx.commit('Décisions de la validation 1.0')
        await ctx.app.validations.sign(ctx.dir, val.id, ctx.ws)
      },
    }, {
      at: '2026-06-25T09:00:00+02:00', by: P.claire, msg: 'Ouverture de la version 2.0', tree: 'produit',
      run: async ctx => {
        await issue(ctx, 'Détection de balourd : couverture partielle', 'en_cours',
          { gravite: 'mineure', description: 'Dérogation accordée en validation 1.0, endurance à exécuter.' },
          { decisions: ['VAL-0001/SYS-0004'] }, ['SYS-0004'])
        await ctx.app.versions.create(ctx.dir, { title: '2.0', components: COMPONENTS_1_0, fields: { description: 'Essorage 1400 tr/min confirmé, pilotage à distance.' } }, ctx.ws)
      },
    }],
  },
  P7: {
    produit: [{
      at: '2026-07-09T09:00:00+02:00', by: P.marc, msg: 'Issue KPI essorage, validation 2.0 commencée', tree: 'produit',
      run: async ctx => {
        const iss = await issue(ctx, "Vitesse d'essorage sous le KPI sur la machine n°4", 'ouverte',
          { gravite: 'majeure', description: '1352 tr/min mesurés par **TSYS-0005**, KPI à 1400 tr/min.' },
          { runs: [ctx.runId('TSYS-0005', 'CAMP-0003', 'PRD-0002')] }, ['PRD-0002'])
        await ctx.app.versions.include(ctx.dir, 'LLV-0002', [iss.id, 'ISS-0002', 'PRD-0013'], ctx.ws)
        await ctx.app.versions.setImpact(ctx.dir, 'LLV-0002', 'SYS-0002', 'impact_a_tester', 'À rejouer après la correction de vitesse.', ctx.ws)
        // Reprend les décisions de la 1.0 ; une proposition reste à confirmer par un humain.
        await ctx.app.validations.create(ctx.dir, { title: 'Validation 2.0', versionId: 'LLV-0002' }, ctx.ws)
        // Hors scope en 1.0, dans le périmètre de la 2.0 : à décider à nouveau.
        for (const requirementId of ['PRD-0010', 'SYS-0013']) await ctx.app.validations.decide(ctx.dir, 'VAL-0002', { requirementId, decision: 'en_attente' }, ctx.ws)
        await ctx.app.validations.propose(ctx.dir, 'VAL-0002', { requirementId: 'SYS-0013', decision: 'conforme', comment: 'Proposé après relecture des essais DVT.' }, ctx.ws)
        // Correctif ouvert à côté de la 2.0, abandonné en P8.
        await ctx.app.versions.create(ctx.dir, { title: '1.1', basedOn: 'LLV-0001', components: COMPONENTS_1_0, fields: { description: 'Correctif de la 1.0, avec endurance (CAMP-0004).' } }, ctx.ws)
      },
    }],
  },
  P8: {
    pompe: [{
      at: '2026-07-20T16:00:00+02:00', by: P.sophie, msg: 'Version 2.0 de la pompe',
      run: ctx => release(ctx, '2.0', 'v2.0', { description: 'Pompe du fournisseur retenu pour la présérie.', include: ctx.backlog() }),
    }],
    moteur: [{
      at: '2026-07-21T09:00:00+02:00', by: P.yann, msg: 'Ouverture de la version 1.3 du moteur', tree: 'moteur',
      run: async ctx => {
        const v = await ctx.app.versions.create(ctx.dir, { title: '1.3', components: { 'if-bus-interne': 'IFV-0001' }, fields: { description: "Correction du temps de coupure, mesure du rendement." } }, ctx.ws)
        await ctx.app.versions.include(ctx.dir, v.id, ['MOT-0007', 'MISS-0001'], ctx.ws)
      },
    }],
    produit: [{
      at: '2026-07-21T14:00:00+02:00', by: P.claire, msg: 'Abandon du correctif 1.1', tree: 'produit',
      run: ctx => ctx.app.versions.update(ctx.dir, 'LLV-0003', { status: 'abandonnee' }, ctx.ws),
    }],
  },
}
