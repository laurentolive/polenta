param([string]$out, [string]$logo)
# GH34 — Gabarit Excel « client » réaliste, construit par Excel lui-même (GH34 sprint 4, spike moteur) :
# logo, titre fusionné, cartouche, ligne modèle stylée avec formule de ligne, mise en forme
# conditionnelle, validation de données, ligne de total (SOMME / NB.SI), seconde feuille qui
# référence le tableau, graphique sur la colonne du tableau, zone d'impression.
$x = New-Object -ComObject Excel.Application
$x.Visible = $false; $x.DisplayAlerts = $false
$wb = $x.Workbooks.Add()
$ws = $wb.Worksheets.Item(1); $ws.Name = 'Exigences'

$ws.Range('A1:E1').Merge()
$ws.Range('A1').Value2 = '${project.label} — Cahier d''exigences'
$ws.Range('A1').Font.Size = 16; $ws.Range('A1').Font.Bold = $true; $ws.Range('A1').Font.Color = 0x643A1F
$ws.Range('A2').Value2 = 'Révision ${git.commit} ${git.tag}'
$ws.Range('A3').Value2 = 'Édité le ${export.date} par ${export.user}'
$ws.Range('A2:A3').Font.Italic = $true
$ws.Shapes.AddPicture($logo, $false, $true, 420, 2, 60, 30) | Out-Null

$headers = @('ID', 'Libellé', 'Statut', 'Priorité', 'Poids x2')
for ($i = 0; $i -lt 5; $i++) { $ws.Cells.Item(5, $i + 1).Value2 = $headers[$i] }
$h = $ws.Range('A5:E5'); $h.Font.Bold = $true; $h.Interior.Color = 0xF3E2D9; $h.Borders.LineStyle = 1

$ws.Range('A6').Value2 = '${table:items.id}'
$ws.Range('B6').Value2 = '${table:items.name}'
$ws.Range('C6').Value2 = '${table:items.statusLabel}'
$ws.Range('D6').Value2 = '${table:items.priority}'
$ws.Range('E6').Formula = '=D6*2'
$r = $ws.Range('A6:E6'); $r.Borders.LineStyle = 1; $r.WrapText = $true; $r.VerticalAlignment = -4160
$ws.Range('D6:E6').NumberFormat = '0.0'
$cf = $ws.Range('C6').FormatConditions.Add(1, 3, '="Approuvé"')   # xlCellValue, xlEqual
$cf.Interior.Color = 0xCEEFC6
$dv = $ws.Range('D6').Validation; $dv.Add(1, 1, 1, '0', '10')        # entier entre 0 et 10

$ws.Range('C8').Value2 = 'Total'
$ws.Range('D8').Formula = '=SUM(D6:D6)'
$ws.Range('E8').Formula = '=SUM(E6:E6)'
$ws.Range('C9').Value2 = 'Approuvées'
$ws.Range('D9').Formula = '=COUNTIF(C6:C6,"Approuvé")'
$ws.Range('C8:D9').Font.Bold = $true
$ws.Columns.Item(1).ColumnWidth = 12; $ws.Columns.Item(2).ColumnWidth = 40; $ws.Columns.Item(3).ColumnWidth = 14
$ws.PageSetup.PrintArea = '$A$1:$E$9'

$s2 = $wb.Worksheets.Add([Type]::Missing, $ws); $s2.Name = 'Synthèse'
$s2.Range('A1').Value2 = 'Nombre d''exigences'
$s2.Range('B1').Formula = '=COUNTA(Exigences!A6:A6)'
$s2.Range('A2').Value2 = 'Priorité moyenne'
$s2.Range('B2').Formula = '=AVERAGE(Exigences!D6:D6)'
$s2.Range('A3').Value2 = 'Composant'
$s2.Range('B3').Value2 = '${project.component}'

$chartObj = $ws.ChartObjects().Add(20, 200, 360, 180)
$chartObj.Chart.ChartType = 51   # xlColumnClustered
$series = $chartObj.Chart.SeriesCollection().NewSeries()
$series.Values = "='Exigences'!`$D`$6:`$D`$6"
$series.XValues = "='Exigences'!`$A`$6:`$A`$6"
$series.Name = 'Priorité'

$ws.Activate()
$wb.SaveAs($out, 51)
$wb.Close($false); $x.Quit()
'ok'
