---
target: /mail
total_score: 23
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 2
timestamp: 2026-09-26T10-31-41Z
slug: apps-web-src-app-mail-page-tsx
---
Method: dual-agent. Score 23/40 (Acceptable).
Nielsen: 1=2 triage silencieux (page.tsx:868) · 2=3 Fait/Archiver ambigus, heure AM/PM · 3=2 undo `z` invisible, pas d'undo swipe · 4=2 menu contextuel maison, tokens danger mélangés · 5=2 swipe gauche=corbeille sur fil (page.tsx:2695) · 6=2 ≤10 icônes seules + 4 badges · 7=3 clavier riche, menu ligne souris-only · 8=2 3 recherches, 2 primaires, poignées DnD permanentes · 9=2 erreurs sans Réessayer · 10=3 aide ? tronquée <900px.
Detector: CLI 1 (layout-transition page.tsx:2398, faux positif). Navigateur: low-contrast 4.4:1 #6d7076/#f1f2f4, labels 10px bottom nav, cibles <32px (étoile 20x28, label 28x28).
Priority issues:
[P1] Triage silencieux + pas d'annulation mobile → pastille d'accord cliquable 6s (harden)
[P1] 5 modèles de triage ; Fait≡Archiver (mail-triage.ts:47) ; en-tête fil 8+13 actions → fusion, 4 actions directes (distill)
[P2] Hiérarchie : 2 primaires, 3 recherches, capture au-dessus du sujet, poignées permanentes (layout/quieter)
[P2] Découvrabilité : touches absentes des tooltips, aide ? sans scroll, menu contextuel sans clavier → Dropdown HeroUI (clarify)
[P2] Mobile : actions en haut du fil, bottom nav affichée en lecture (adapt)
Personas: Alex d/e + menu souris ; Sam focus menu, étoile couleur seule, erreurs non role=alert ; Casey swipe corbeille 88px, pas d'undo.
Minor: fr-FR heures, placeholder brut, sujets coupés à 18rem, bulles teal saturées.
