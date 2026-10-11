import { test, expect, type Page } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { E2E } from './support/env'
import { activityBar, setupSession } from './support/session'
import PizZip from 'pizzip'

/**
 * GH44 S4 — impression côté serveur (Chromium headless) : exports PDF des vues, depuis l'interface,
 * comme sur le desktop (specs/GH44-tests.md S4-1).
 */
const s = setupSession()

async function exportPdf(page: Page, name: string): Promise<Buffer> {
  await page.getByRole('button', { name: 'Exporter' }).first().click()
  const downloadPromise = page.waitForEvent('download', { timeout: 60_000 })
  await page.getByRole('button', { name: 'PDF' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.pdf$/)
  const target = path.join(E2E.downloadsDir, `${name}-${download.suggestedFilename()}`)
  await download.saveAs(target)
  await expect(page.getByText(/^Téléchargé :/)).toBeVisible()
  await page.getByRole('button', { name: 'Fermer' }).click()
  return fs.readFileSync(target)
}

function pageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) ?? []).length
}

test('S4-1 — export PDF de la vue Exigences', async () => {
  await s.openView('Exigences')
  await expect(s.page.getByText('PRD-0001')).toBeVisible({ timeout: 30_000 })
  const pdf = await exportPdf(s.page, 'exigences')
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pageCount(pdf)).toBeGreaterThan(0)
  expect(pdf.length).toBeGreaterThan(10_000)
})

test('S4-1 — export PDF d\'un dashboard', async () => {
  await s.openView('Suivi')
  const pdf = await exportPdf(s.page, 'dashboard')
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
  expect(pageCount(pdf)).toBeGreaterThan(0)
})

test('S4-3 — trois exports PDF simultanés (file d\'attente de l\'imprimante)', async () => {
  // Trois onglets du même utilisateur (mode dev : un seul compte), exports lancés ensemble :
  // au plus deux rendus en parallèle, le troisième attend, tous aboutissent.
  const pages = await Promise.all([0, 1, 2].map(() => s.context.newPage()))
  try {
    for (const p of pages) {
      await p.goto(s.projectUrl('/dashboard'))
      await activityBar(p).and(p.locator('[title="Exigences"]')).click()
      await expect(p.getByText('PRD-0001')).toBeVisible({ timeout: 30_000 })
    }
    const pdfs = await Promise.all(pages.map((p, i) => exportPdf(p, `simultane-${i}`)))
    for (const pdf of pdfs) {
      expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
      expect(pageCount(pdf)).toBeGreaterThan(0)
    }
  } finally {
    for (const p of pages) await p.close()
  }
})

test('S4-2 — export Word par gabarit : diagrammes draw.io rendus en images', async () => {
  // Gabarits d'exemple dans la bibliothèque de l'utilisateur (espace serveur).
  await s.invoke('export-templates:install-examples')
  // 404 attendus, identiques au desktop (ERR_FILE_NOT_FOUND) : adresse « réseau coupé » du viewer
  // draw.io (`__drawio-network-disabled__`) et image relative du contenu de la démo.
  s.allowConsoleErrors(/status of 404 \(Not Found\)/)
  await s.openView('Exigences')
  // Exigences système : leurs énoncés contiennent des diagrammes draw.io.
  const picker = s.page.getByRole('textbox', { name: 'Sélectionner un composant / élément…' })
  await picker.click()
  await picker.fill('Exigence Système')
  await s.page.getByText(/Exigence Système/).last().click()
  await expect(s.page.getByText('SYS-0001')).toBeVisible({ timeout: 30_000 })

  await s.page.getByRole('button', { name: 'Exporter' }).first().click()
  await s.page.getByRole('combobox', { name: 'Gabarit Word' }).selectOption({ label: 'Exemples Polenta/Cahier des exigences.docx' })
  const downloadPromise = s.page.waitForEvent('download', { timeout: 120_000 })
  await s.page.getByRole('button', { name: 'Word' }).click()
  const download = await downloadPromise
  const target = path.join(E2E.downloadsDir, `gabarit-${download.suggestedFilename()}`)
  await download.saveAs(target)
  await s.page.getByRole('button', { name: 'Fermer' }).click()

  const zip = new PizZip(fs.readFileSync(target))
  const images = Object.keys(zip.files).filter(f => /^word\/media\/.+\.png$/.test(f))
  expect(images.length, 'diagrammes rendus en PNG dans le document').toBeGreaterThan(0)
  for (const img of images) {
    const png = zip.file(img)!.asNodeBuffer()
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.length).toBeGreaterThan(2_000) // pas une image vide
  }
  // Repli texte « [Diagramme : …] » absent : tous les diagrammes ont été capturés.
  expect(zip.file('word/document.xml')!.asText()).not.toContain('[Diagramme')
})
