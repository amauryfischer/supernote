---
target: /mail
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-09-27T10-51-42Z
slug: apps-web-src-app-mail-page-tsx
---
Method: dual-agent. Score 27/40 (Good), précédent 23/40.
Nielsen: 1=3 · 2=3 (s/h tous deux Reporter) · 3=3 (pastille 6s sans pause) · 4=2 (3 mécanismes annuler/supprimer, window.confirm vs useConfirm, 2× « Plus d'actions » mobile) · 5=3 · 6=2 (6 icônes sans libellé, 2/17 raccourcis dans Plus) · 7=3 (pas de Cc/Cci) · 8=2 (Plus 17 lignes, primaire TopBar = note) · 9=3 (Réessayer) · 10=3 (aide introuvable mobile).
Detector: CLI 1 (faux positif page.tsx:2411). Navigateur : contraste résolu (text-muted 5.14 sur surface-2, 4.69 sur surface-3), 0 débordement mobile, barre triage fil en bas (y800/844). Restes : étoile ligne mobile 20×28, nav bas 10px (MobileBottomNav), line-length ~102 fil desktop.
Priority issues:
[P1] Menu de ligne hors écran (MailOverlayList.tsx:988, top=innerHeight-380 vs max-h 80vh) + double anneau focus → harden
[P1] Plus = 17 actions à plat, sans role menu/flèches (EmailThreadView.tsx:988-1230) → distill (sections ≤4)
[P1] Hiérarchie inversée : seul primaire /mail = Nouveau (note), compose = crayon discret → layout (primaire TopBar = Nouveau message sur /mail)
[P2] 3 mécanismes annuler/supprimer : pastille sans pause + (z) sur mobile, toast « Envoi annulé » (useDeferredSend.ts:127), window.confirm (ComposeModal.tsx:308) → harden
[P2] Pas de Cc/Cci au composeur (ComposeModal.tsx:316) → shape
Personas: Alex menu . coupé, pas de Cc ; Sam tablist sans role=tab, 2× Plus d'actions, pastille sans pause (WCAG 2.2.1) ; Casey barre basse justify-around irrégulière, ⋮ haut à 1 action, étoile 20×28.
