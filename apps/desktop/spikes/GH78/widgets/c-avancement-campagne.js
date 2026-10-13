// (c) Avancement d'une campagne dans le temps (courbe empilée des statuts d'entrées).
// Paramètres : `campaignId` (absent : toutes les campagnes cumulées), `step` en jours,
// `ids` (défaut vrai : IDs des tests par ligne pour le drill-down).
import { campaignsTimeline } from 'lib/campaign.js'

export default function (data, polenta) {
  const { campaignId, step = 1, ids = true } = polenta.params
  const campaigns = campaignId ? data.campaigns.filter(c => c.id === campaignId) : data.campaigns
  if (campaignId && campaigns.length === 0) throw new Error('Campagne introuvable : ' + campaignId)
  const to = campaignId ? campaigns[0].completedAt || polenta.now : polenta.now
  return campaignsTimeline(campaigns, data.runs, { to, step, ids })
}
