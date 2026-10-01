param([string]$out)
# GH34 — Gabarit Word « client » avec table des matières, construit par Word lui-même : la table
# est calculée sur le gabarit vide, et le gabarit ne demande pas de mise à jour des champs —
# Polenta doit l'ajouter (`DocxPackage.finalize`) pour que la table soit à jour à l'ouverture.
$w = New-Object -ComObject Word.Application
$w.Visible = $false; $w.DisplayAlerts = 0
$d = $w.Documents.Add()
$r = $d.Content
$r.Text = '{{project.label}} — Cahier client'
$r.Style = -63   # wdStyleTitle
$r.InsertParagraphAfter()
$p = $d.Paragraphs.Add(); $p.Range.Text = 'Sommaire'; $p.Range.InsertParagraphAfter()
$tocAnchor = $d.Paragraphs.Add().Range
$tocAnchor.InsertParagraphAfter()
foreach ($line in @('{{#items}}', '{{#isFolder}}', '{{section}} {{name}}', '{{/isFolder}}', '{{#isItem}}', '{{id}} — {{name}}', '{{/isItem}}', '{{/items}}')) {
  $p = $d.Paragraphs.Add(); $p.Range.Text = $line; $p.Range.InsertParagraphAfter()
}
foreach ($para in $d.Paragraphs) {
  if ($para.Range.Text.Trim() -eq '{{section}} {{name}}') { $para.Style = -2 }   # wdStyleHeading1
  if ($para.Range.Text.Trim() -eq '{{id}} — {{name}}') { $para.Style = -3 }     # wdStyleHeading2
}
$d.TablesOfContents.Add($tocAnchor, $true, 1, 2) | Out-Null
$d.SaveAs2($out, 16)
$d.Close(0); $w.Quit()
'ok'
